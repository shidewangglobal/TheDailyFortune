# Kiến thức lõi: Phối Lục Thập Hoa Giáp × 6 cung Lục Nhâm × tuổi

Phần này bổ sung **phương pháp luận** cho lớp độn toán: không đọc **tách rời** Hoa Giáp với cung, mà luôn **chồng hai tính chất** rồi mới chồng **tuổi (độ số)** của người (và đối tượng nếu có).

---

## 1. Hai tính chất + một lớp người

| Lớp | Ý nghĩa trong luận giải | Trong payload (thường gặp) |
|-----|-------------------------|----------------------------|
| **Tính trời** | Vòng Quang Lục Giáp / **Lục Thập Hoa Giáp** của **thời điểm**: Can Chi, **Nạp âm**, **hành** của **ngày** và **giờ** | `day_can_chi`, `hour_can_chi`, `day_menh`, `hour_menh`, `day_element`, `hour_element`, v.v. |
| **Tính người (khung thời gian)** | **6 cung** Lục Nhâm theo chu trình tháng → ngày → giờ — mỗi cung mang **tính chất riêng** | `month_cung`, `day_cung`, `hour_cung` |
| **Độ số tuổi** | Tuổi Can Chi + mệnh/hành **người xem**; nếu có thêm người tham gia / khách / đối tác | `owner_can_chi`, `owner_menh`, `owner_element`, các trường participant tương ứng |

**Đáp số trùng lặp:** Việc con người (tuổi, hành) **đi cùng** thời gian = khi **Hoa Giáp của ngày/giờ** được hiểu là **đang nằm trên** **cung** tương ứng (cùng “khung” tháng/ngày/giờ), rồi **cộng hưởng** với tuổi — đó là lõi của môn, không phải ba bảng tách biệt.

---

## 2. Cấm (anti-pattern) — vi phạm là luận thiếu

1. **Không** chỉ liệt kê “cung tháng Xích Khẩu” rồi sau đó chỉ nói “mệnh giờ Kỷ Mùi…” mà **không** nói rõ **mệnh giờ đó đang đứng trên cung giờ nào** và **cặp ngày–giờ** (`main_pair` / phạm vi đang luận) **tổng hợp** ra ý gì.
2. **Không** chỉ luận ngũ hành người xem ↔ ngày rồi **bỏ** **cung ngày** đang mang mệnh ngày đó.
3. **Không** kết luận “giờ tốt/xấu” chỉ từ **một** lớp (chỉ cung, hoặc chỉ Nạp âm) khi payload đã có **đủ** cung + mệnh **cùng khung**.

---

## 3. Bắt buộc trong văn xuôi (không tách bullet trong câu trả lời user)

1. **Mỗi tầng thời gian đang dùng (tháng / ngày / giờ):** ít nhất một nhịp câu dạng ý: *mệnh Hoa Giáp (Can Chi + Nạp âm + hành) của [ngày hoặc giờ] **khi đặt trên** cung [tên cung] …* — rồi mới nối chủ đề / hành động.
2. **Ghép ngày + giờ:** Luôn có **một đoạn** (có thể ngắn) nói **hai tầng** cùng lúc: tín hiệu **cặp ngày–giờ** (`main_pair` nếu có) **không** tách thành hai kết luận mâu thuẫn.
3. **Chồng tuổi:** Sau khi đã ghép Hoa Giáp × cung, **phải** nối **ít nhất một lần** tuổi/mệnh người xem (và đối tượng nếu có) với **tín hiệu ngày** và **tín hiệu giờ** — diễn thành **hình tượng công việc** (họp, ký, tiền, pháp lý, quan hệ…) theo `topic` / `topic_intent`, không nói chung chung.

---

## 4. Cung với cung: chuỗi tháng → ngày → giờ

- **Cung tháng:** khí / nền **giai đoạn** (dễ tranh luận, dễ kéo dài, v.v. — bám đúng tên cung trong payload).
- **Cung ngày:** **khung việc trong ngày**; nối với **mệnh ngày** cùng khung.
- **Cung giờ:** **cửa sổ hành động**; nối với **mệnh giờ** cùng khung.

Luận theo **chuỗi thời gian** và **chồng lớp** với Hoa Giáp — không ba đoạn mô tả độc lập không cầu nối.

---

## 5. Bảng phối mẫu (chỉ dùng khi payload **thật sự** chứa các thành phần tên — không bịa)

Các ví dụ dưới là **hướng hình tượng hóa** khi dữ liệu **khớp**; nếu payload không có tổ hợp đó thì **không** áp cứng.

| Điều kiện (từ payload / tên trong input) | Hướng luận (gắn chủ đề) |
|----------------------------------------|-------------------------|
| **Lưu Liên** đồng hiện với tín hiệu **Không Vong** trong **cùng nhịp luận** (cung / phạm vi payload cho phép) | Khuất tất, chui luồn, giấy tờ **không rõ ràng**; rủi ro **bất hợp pháp** hoặc làm qua đường vòng — nhắc: đúng kênh, minh bạch, tránh nhờ kẻ không đủ tư cách. |
| Nạp âm **Bạch Lạp Kim** ở **mệnh ngày hoặc giờ** khi **cung tương ứng** là **Lưu Liên** | Cạnh **pháp lý, điều khoản, tranh chấp nhỏ**; dễ “vướng lười” — ưu tiên văn bản rõ, chữ ký đúng thẩm quyền. |
| Nạp âm **Trường Lưu Thủy** ở mệnh **kết hợp** với **Không Vong** ở lớp cung mà payload phản ánh | **Hao tài, tốn của**, tiền hoặc công sức **chảy** không đúng chỗ — hạn chế chi trước, cam kết bằng văn bản, kiểm chứng đối tác. |

**Mẫu tích hợp (cấu trúc — không copy nguyên văn vào mọi bài):** Một người tuổi X, tháng Y, ngày/giờ mang tổ hợp cung + nạp âm gợi **pháp lý + hao tài** → luận **một mạch**: nhờ sai chỗ lo giấy tờ → mất tiền + tai tiếng — **chỉ khi** các thành phần tuổi/thời gian đó **có trong payload**.

---

## 6. Đối tượng thứ hai (khách, đối tác)

Khi có **participant** / hành đối tượng: sau khi đã **Hoa Giáp × cung × chủ**, thêm **một nhịp** so **hành giờ (hoặc ngày)** với **hành đối tượng** (vd Hỏa khắc Kim) — diễn thành **áp lực cảm nhận / khó chốt ngay**, bám `topic`, không mở rộng ngoài dữ liệu.

---

## 7. Khung suy nghĩ (không phải câu trả lời cho user)

Dùng nội bộ khi soạn **ba đoạn văn dài** — **không** thay thế luận giải bằng một câu tóm tắt:

**Luận = (Hoa Giáp của thời điểm đặt trên cung Lục Nhâm tương ứng) + (ghép ngày–giờ) + (chồng tuổi & đối tượng) → hình tượng việc đời theo chủ đề.**
