# Daily fortune

Project phong thuy tach rieng hoan toan (khong lien quan Joy).

## Chay local

Yeu cau: Node.js 18+.

```bash
cd daily-fortune
npm start
```

Mo trinh duyet:

- http://localhost:4180

## Deploy public (Render)

1. Vao [Render Dashboard](https://dashboard.render.com/) -> **New +** -> **Blueprint**.
2. Connect GitHub repo: `shidewangglobal/TheDailyFortune`.
3. Render se doc file `render.yaml` da co san.
4. Bam **Apply** de deploy.
5. Sau khi deploy xong, ban se co link public dang:
   - `https://daily-fortune.onrender.com` (hoac ten tuong tu).

## Chay tren may tinh khac tu Shared Drive

1. Mo Shared Drive, vao dung thu muc `daily-fortune`.
2. Mo terminal tai thu muc do.
3. Chay:

```bash
npm start
```

4. Neu bao loi Node chua cai dat, cai Node.js LTS truoc.
5. Mo: http://localhost:4180

## Ghi chu

- Day la ban sample UI/UX de duyet thiet ke.
- Chua nhung backend thanh toan hoac auth production.
