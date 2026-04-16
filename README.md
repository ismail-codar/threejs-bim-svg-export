# Three.js BIM -> SVG Export Pipeline

Bu proje, Three.js ile render edilen BIM benzeri bir sahneyi çok katmanlı raster->vector pipeline ile SVG'ye dönüştüren örnek bir çalışır projedir.

## Özellikler

- Browser tarafında Three.js render
- Edge pass: `EdgesGeometry`
- Fill pass: flat `MeshBasicMaterial`
- Opsiyonel shading pass
- Backend tarafında:
  - Öncelik: `potrace` / `vtracer`
  - Fallback: dahili polygon/rect tabanlı SVG üretici
- SVGO optimizasyonu
- İstatistik üretimi
- Tek tıkla SVG indirme

## Teknolojiler

- Vite
- TypeScript
- Three.js
- Express
- Sharp
- SVGO

## Kurulum

### 1) Node modülleri

```bash
npm install
```

Eğer npm auth / registry sorunu alırsan:

```bash
npm config set registry https://registry.npmjs.org/
npm install
```

### 2) İsteğe bağlı CLI araçları

#### Potrace

Ubuntu:

```bash
sudo apt update
sudo apt install potrace
```

#### vtracer

Cargo ile:

```bash
cargo install vtracer
```

Not: Bu araçlar kurulu değilse proje otomatik fallback vectorizer kullanır. Yani yine çalışır, ama en iyi mimari çizgi kalitesi için `potrace`/`vtracer` önerilir.

## Çalıştırma

### Geliştirme

İki terminal aç:

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npx tsc -p tsconfig.server.json
npm run server
```

Ardından tarayıcıda:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`

### Production benzeri

```bash
npm run build
npm run server
npx vite preview --host 0.0.0.0 --port 4173
```

## Mimari

### Browser

- Sahne render edilir
- Edge scene oluşturulur
- Flat fill scene oluşturulur
- İsteğe bağlı shading scene oluşturulur
- Render target okunur
- PNG base64 olarak backend'e POST edilir

### Server

- Edge PNG threshold uygulanır
- CLI varsa:
  - Edge: `potrace` veya `vtracer`
  - Fill: `vtracer`
- CLI yoksa fallback SVG üretimi yapılır
- Katmanlar merge edilir
- SVGO ile optimize edilir

## Dosya Yapısı

```text
src/
  client/
    exporter.ts
    main.ts
    types.ts
  server/
    server.ts
    svg-pipeline.ts
```

## Notlar

- Edge pass için antialias kapalı tutuldu.
- En iyi düz çizgi sonucu için `potrace + alphamax=0` önerilir.
- Büyük modellerde `scaleFactor=2` ile başlanıp sonra artırılması tavsiye edilir.
- Fallback vectorizer, kalite olarak CLI araçlarının yerini tamamen tutmaz; sadece proje her ortamda ayağa kalksın diye eklendi.

## Geliştirme Önerileri

Gerçek üretim kullanımında şunları eklemen iyi olur:

- GLTF/IFC yükleme
- OrbitControls
- Gerçek depth/AO pass
- Worker queue
- SVG katman bazlı export seçenekleri
- Daha gelişmiş fallback edge tracing

