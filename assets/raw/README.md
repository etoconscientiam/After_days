Сюда кладутся исходники из Gemini как есть (PNG или JPEG, фон — хромакей #FF00FF), с именами из src/config/assets.json, и запускается:

    npm run prep-assets

Готовые файлы появятся в assets/world и assets/ui; игра подхватит их при следующей сборке без правки кода.
Пока файла нет, используется процедурный плейсхолдер.

Как разложены присланные картинки (исходные имена Gemini — в SOURCES.json):

| файл | что это | куда |
|---|---|---|
| sky_sun, sky_moon | солнце, луна | world/sky/ (тонируются временем суток) |
| sky_clouds | облака, сетка 2×2 | world/sky/cloud_1..4 (параллакс, тон по времени суток) |
| hills_far, hills_near | дальние горы, ближние холмы | world/hills/ (средний план пока процедурный — нужен hills_mid) |
| surface_grass, surface_barren, surface_beach, surface_water | кромки зон | world/surface/ (из двухрядных картинок берётся верхний ряд, колонки выпрямляются) |
| tex_soil, silt, sand, sandstone, clay, limestone, shale, coal, peat, dust | текстуры слоёв | world/tex/ (64×64; без своей текстуры материал берёт родственную, тонированную своим цветом) |
| tex_bedrock, tex_technogenic, tex_compacted | коренная порода, техногенный горизонт, уплотнённая толща и фундамент | world/tex/ |
| artifact_a (кольцо), artifact_b (ключ), artifact_c (палочка) | вещи | world/items/ (+ малый вариант 14 px для дна среза) |
| tab_*, energy, rock_*, density | иконки интерфейса | ui/icons/ |

artifact_c.png нарисован кодом в стиле кольца и ключа: tools/draw_wand.py (python3 tools/draw_wand.py assets/raw/artifact_c.png).
tab_upgrades_alt — второй вариант стрелки, не используется.
