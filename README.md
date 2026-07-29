# PDF Table Extractor

Công cụ web trích xuất bảng tỷ giá ngoại tệ từ PDF sang Excel và tự động quy đổi sang USD.

**Author: Huỳnh Cỏ Khô**

## Sử dụng trực tuyến

<https://huynhcokho.github.io/FDF-To-Excel-Rate/>

PDF được xử lý ngay trong trình duyệt và không tải lên máy chủ.

## Chức năng

- Nhận PDF có chữ hoặc PDF scan cần OCR.
- Xuất workbook Excel gồm hai sheet `Du lieu` và `Thong tin`.
- Giữ số trang nguồn và cảnh báo những ô cần kiểm tra.
- Tự nhận tỷ giá USD/VNĐ và tính giá trị quy đổi sang USD.
- Hoạt động trên máy tính và điện thoại, không yêu cầu cài Microsoft Excel.

## Phát triển

```bash
npm install
npm run build:pages
```

GitHub Pages được phục vụ từ thư mục `docs` trên nhánh `main`.
