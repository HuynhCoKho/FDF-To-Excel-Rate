"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";

type OcrWord = { text: string; x: number; y: number; width: number; height: number };
type DataRow = {
  STT: number;
  "Tên ngoại tệ": string;
  "Ngoại tệ": string;
  "Tỷ giá Ngoại tệ/VNĐ": number | "";
  "Quy đổi sang USD (1 ngoại tệ = ... USD)": number | "";
  "Trang PDF": number;
  "Cảnh báo kiểm tra": string;
};

const MAX_SIZE = 200 * 1024 * 1024;

function normalizeNumber(value: string) {
  const digits = value.toUpperCase().replace(/[O]/g, "0").replace(/[IL|]/g, "1").replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

function joinWords(words: OcrWord[]) {
  return words
    .sort((a, b) => a.x - b.x)
    .map((word) => word.text)
    .join(" ")
    .replace(/[|[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePage(words: OcrWord[], page: number, width: number) {
  const rows: Array<Omit<DataRow, "Quy đổi sang USD (1 ngoại tệ = ... USD)"> & { y: number }> = [];
  if (!words.length) return rows;
  const height = Math.max(...words.map((word) => word.y + word.height), 1);
  const centerX = (word: OcrWord) => word.x + word.width / 2;
  const centerY = (word: OcrWord) => word.y + word.height / 2;
  const yTolerance = Math.max(11, height / 245);
  const minY = height * 0.09;
  const maxY = height * 0.94;

  // Windows OCR của bản local tạo neo dòng từ STT, mã hoặc tỷ giá.
  // Tesseract thường đọc đường kẻ bảng thành [, ], | nên không thể chỉ dựa vào STT "sạch".
  const anchors = words.flatMap((word) => {
    const cx = centerX(word);
    const cy = centerY(word);
    if (cy < minY || cy > maxY) return [];
    const rowNumber = cx < width * 0.18 ? normalizeNumber(word.text) : null;
    const looksRow = rowNumber !== null && rowNumber > 0 && rowNumber < 1000;
    const looksCode = cx >= width * 0.47 && cx < width * 0.62 && /^[|[\]({]*[A-Z0-9]{3,4}[|[\])}]*$/i.test(word.text.trim());
    const looksRate = cx >= width * 0.72 && normalizeNumber(word.text) !== null;
    return looksRow || looksCode || looksRate ? [cy] : [];
  }).sort((a, b) => a - b);

  const clusters: Array<{ y: number; count: number }> = [];
  for (const y of anchors) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(y - last.y) > yTolerance) clusters.push({ y, count: 1 });
    else {
      last.y = (last.y * last.count + y) / (last.count + 1);
      last.count++;
    }
  }

  const makeRow = (rowY: number, recovered = false) => {
    const line = words.filter((word) => Math.abs(centerY(word) - rowY) <= yTolerance);
    const numberTokens = line.filter((word) => centerX(word) < width * 0.18);
    let stt: number | null = null;
    for (const token of numberTokens) {
      const candidate = normalizeNumber(token.text);
      if (candidate && candidate < 1000) { stt = candidate; break; }
    }
    const name = joinWords(line.filter((word) => centerX(word) >= width * 0.135 && centerX(word) < width * 0.47));
    const codeRaw = joinWords(line.filter((word) => centerX(word) >= width * 0.47 && centerX(word) < width * 0.62))
      .toUpperCase().replace(/[^A-Z0-9]/g, "");
    const code = (codeRaw.match(/[A-Z]{3}/) || [codeRaw.slice(0, 3)])[0] || "";
    const rateRaw = joinWords(line.filter((word) => centerX(word) >= width * 0.72));
    const rate = normalizeNumber(rateRaw);
    if ((!stt && !code && !rate && !recovered) || (!name && !recovered) || /NGOẠI|TY GIA|TỶ GIÁ/i.test(name)) return null;
    const warnings: string[] = [];
    if (recovered) warnings.push("Dòng được phục hồi theo lưới bảng; cần đối chiếu.");
    if (!name) warnings.push("Cần kiểm tra tên ngoại tệ.");
    if (!/^[A-Z]{3}$/.test(code)) warnings.push("Cần kiểm tra mã ngoại tệ.");
    if (!rate) warnings.push("Cần kiểm tra tỷ giá.");
    return {
      STT: stt || 0,
      "Tên ngoại tệ": name,
      "Ngoại tệ": code,
      "Tỷ giá Ngoại tệ/VNĐ": rate || "",
      "Trang PDF": page,
      "Cảnh báo kiểm tra": warnings.join(" "),
      y: rowY,
    };
  };

  const candidates = clusters
    .map((cluster) => makeRow(cluster.y))
    .filter((row): row is NonNullable<ReturnType<typeof makeRow>> => row !== null)
    .sort((a, b) => a.y - b.y);
  if (candidates.length < 10) return rows;

  // Giữ đoạn liên tục dài nhất của bảng, bỏ phần công văn/tiêu đề.
  let bestStart = 0, bestEnd = 0, start = 0;
  for (let i = 1; i < candidates.length; i++) {
    const gap = candidates[i].y - candidates[i - 1].y;
    if (gap < height * 0.007 || gap > height * 0.05) {
      if (i - 1 - start > bestEnd - bestStart) { bestStart = start; bestEnd = i - 1; }
      start = i;
    }
  }
  if (candidates.length - 1 - start > bestEnd - bestStart) {
    bestStart = start;
    bestEnd = candidates.length - 1;
  }
  const segment = candidates.length >= 25 ? candidates : candidates.slice(bestStart, bestEnd + 1);
  if (segment.length < 25) return rows;

  const gaps = segment.slice(1).map((row, index) => row.y - segment[index].y)
    .filter((gap) => gap >= height * 0.007 && gap <= height * 0.028)
    .sort((a, b) => a - b);
  const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : height * 0.015;
  for (let i = 0; i < segment.length; i++) {
    rows.push(segment[i]);
    if (i + 1 >= segment.length) continue;
    const gap = segment[i + 1].y - segment[i].y;
    const missing = Math.max(0, Math.round(gap / step) - 1);
    for (let m = 1; m <= missing; m++) {
      const recovered = makeRow(segment[i].y + step * m, true);
      if (recovered) rows.push(recovered);
    }
  }
  return rows.sort((a, b) => a.y - b.y);
}

function getUsdRate(words: OcrWord[]) {
  const ordered = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < ordered.length; i++) {
    if (!/USD/i.test(ordered[i].text)) continue;
    const sameLine = ordered.filter((word) =>
      word.x > ordered[i].x && word.x < ordered[i].x + 550 &&
      Math.abs(word.y - ordered[i].y) < Math.max(22, ordered[i].height),
    );
    for (const word of sameLine) {
      const value = normalizeNumber(word.text);
      if (value && value >= 1000) return value;
    }
  }
  return null;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Sẵn sàng");
  const [result, setResult] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const choose = (picked?: File) => {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".pdf")) return alert("Vui lòng chọn file PDF.");
    if (picked.size > MAX_SIZE) return alert("File vượt quá 200 MB.");
    setFile(picked);
    setResult("");
    setStatus("Sẵn sàng");
    setProgress(0);
  };

  const extract = async () => {
    if (!file || running) return;
    setRunning(true);
    setResult("");
    try {
      setStatus("Đang mở tài liệu PDF…");
      setProgress(2);
      const pdfjs = await import("pdfjs-dist");
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
      pdfjs.GlobalWorkerOptions.workerSrc = `${basePath}/pdf.worker.min.mjs`;
      const { createWorker } = await import("tesseract.js");
      const XLSX = await import("xlsx");
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const extracted: ReturnType<typeof parsePage> = [];
      let usdRate: number | null = null;
      let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setStatus(`Đang đọc trang ${pageNumber}/${pdf.numPages}…`);
        setProgress(Math.round(5 + (pageNumber - 1) / pdf.numPages * 78));
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2.35 });
        const textContent = await page.getTextContent();
        let words: OcrWord[] = [];

        if (textContent.items.length > 12) {
          words = textContent.items.flatMap((item: any) => {
            const text = String(item.str || "").trim();
            if (!text) return [];
            const tx = pdfjs.Util.transform(viewport.transform, item.transform);
            return [{ text, x: tx[4], y: viewport.height - tx[5], width: Math.abs(item.width * 2), height: Math.max(10, Math.abs(item.height * 2)) }];
          });
        } else {
          setStatus(`Đang OCR trang scan ${pageNumber}/${pdf.numPages}…`);
          if (!ocrWorker) {
            ocrWorker = await createWorker("eng");
            await ocrWorker.setParameters({
              tessedit_pageseg_mode: "11",
              preserve_interword_spaces: "1",
              user_defined_dpi: "170",
            } as any);
          }
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh PDF.");
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          const recognition: any = await ocrWorker.recognize(canvas, {}, { blocks: true });
          const detected = recognition.data.words ||
            recognition.data.blocks?.flatMap((block: any) => block.paragraphs?.flatMap((p: any) => p.lines?.flatMap((l: any) => l.words || []) || []) || []) || [];
          words = detected.map((word: any) => ({
            text: word.text,
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0,
          }));
        }
        if (pageNumber === 1) usdRate = getUsdRate(words);
        extracted.push(...parsePage(words, pageNumber, viewport.width));
      }
      await ocrWorker?.terminate();
      if (!extracted.length) throw new Error("Không tìm thấy bảng phù hợp. Hãy dùng PDF có cột STT, tên ngoại tệ, mã và tỷ giá.");

      const ordered = extracted.sort((a, b) => a["Trang PDF"] - b["Trang PDF"] || a.y - b.y);
      const rows: DataRow[] = ordered.map(({ y: _y, ...row }, index) => ({
        ...row,
        STT: index + 1,
        "Quy đổi sang USD (1 ngoại tệ = ... USD)": usdRate && row["Tỷ giá Ngoại tệ/VNĐ"]
          ? Number((Number(row["Tỷ giá Ngoại tệ/VNĐ"]) / usdRate).toFixed(8))
          : "",
      }));
      if (usdRate && !rows.some((row) => row["Ngoại tệ"] === "USD")) {
        rows.unshift({
          STT: 1,
          "Tên ngoại tệ": "US DOLLAR",
          "Ngoại tệ": "USD",
          "Tỷ giá Ngoại tệ/VNĐ": usdRate,
          "Quy đổi sang USD (1 ngoại tệ = ... USD)": 1,
          "Trang PDF": 1,
          "Cảnh báo kiểm tra": "Tỷ giá USD/VNĐ được lấy từ nội dung trang 1.",
        });
        rows.forEach((row, index) => { row.STT = index + 1; });
      }

      setStatus("Đang tạo file Excel…");
      setProgress(92);
      const book = XLSX.utils.book_new();
      const dataSheet = XLSX.utils.json_to_sheet(rows);
      dataSheet["!cols"] = [{ wch: 8 }, { wch: 34 }, { wch: 13 }, { wch: 20 }, { wch: 34 }, { wch: 12 }, { wch: 42 }];
      XLSX.utils.book_append_sheet(book, dataSheet, "Du lieu");
      const info = XLSX.utils.aoa_to_sheet([
        ["Thông tin", "Chi tiết"],
        ["File nguồn", file.name],
        ["Số trang", pdf.numPages],
        ["Số dòng", rows.length],
        ["Thời gian trích xuất", new Date().toLocaleString("vi-VN")],
        ["Công nghệ", "PDF.js và Tesseract OCR, xử lý cục bộ trong trình duyệt"],
        ["Kiểu dữ liệu", "STT, tỷ giá, quy đổi USD và trang PDF là Number; tên và mã ngoại tệ là Text."],
      ]);
      info["!cols"] = [{ wch: 24 }, { wch: 82 }];
      XLSX.utils.book_append_sheet(book, info, "Thong tin");
      XLSX.writeFile(book, file.name.replace(/\.pdf$/i, "") + "_trich_xuat.xlsx");
      setProgress(100);
      setStatus("Hoàn tất");
      setResult(`Đã xuất ${rows.length} dòng dữ liệu. File Excel đã được tải xuống.`);
    } catch (error) {
      setProgress(0);
      setStatus("Chưa thể hoàn tất");
      alert(error instanceof Error ? error.message : "Có lỗi khi xử lý PDF.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden="true">▦</div>
          <div>
            <p className="author">Author: Huỳnh Cỏ Khô</p>
            <h1>PDF Table Extractor</h1>
            <p>Trích xuất bảng tỷ giá PDF thành Excel</p>
          </div>
        </div>
        <div className="privacy"><span /> Xử lý ngay trên thiết bị</div>
        <img className="stamp" src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/dau-ten.png`} alt="Con dấu Huỳnh Cỏ Khô" />
      </header>

      <section className="tool-card">
        <div className="hero">
          <div className="eyebrow">PDF → XLSX · TỰ ĐỘNG QUY ĐỔI USD</div>
          <h2>Biến bảng tỷ giá trong PDF thành Excel</h2>
          <p>Kéo thả tài liệu PDF. Công cụ nhận dạng hàng, cột, giữ trang nguồn, đánh dấu dữ liệu cần đối chiếu và tính giá trị quy đổi sang USD.</p>
        </div>

        <div
          className={`dropzone ${file ? "has-file" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            choose(event.dataTransfer.files[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()}
          aria-label="Chọn file PDF"
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0])}
            hidden
          />
          <div className="upload-icon">⇧</div>
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{(file.size / 1024 / 1024).toFixed(2)} MB · Bấm để chọn file khác</span>
            </>
          ) : (
            <>
              <strong>Kéo thả file PDF vào đây</strong>
              <span>hoặc <b>bấm để chọn file</b> · tối đa 200 MB</span>
            </>
          )}
        </div>

        <button className="primary" disabled={!file || running} onClick={extract}>
          {running ? "Đang xử lý…" : "Quét và xuất Excel"}
        </button>

        {(running || progress > 0) && (
          <div className="progress-wrap" aria-live="polite">
            <div className="progress-head"><span>{status}</span><b>{progress}%</b></div>
            <div className="progress"><div style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {result && <div className="success"><b>✓ Hoàn tất</b><span>{result}</span></div>}

        <div className="features">
          <article><b>Đúng kiểu dữ liệu</b><span>Số lưu dạng Number; tên và mã ngoại tệ lưu dạng Text.</span></article>
          <article><b>Quy đổi sang USD</b><span>Tự nhận tỷ giá USD/VNĐ và tính công thức cho từng ngoại tệ.</span></article>
          <article><b>Dễ đối chiếu</b><span>Giữ số trang nguồn và cảnh báo các ô OCR chưa chắc chắn.</span></article>
        </div>
      </section>

      <footer>PDF được xử lý cục bộ trong trình duyệt và không tải lên máy chủ.</footer>
    </main>
  );
}
