Положите сюда картинки из Gemini как есть (PNG, фон — хромакей #FF00FF), с именами из src/config/assets.json
(например `portrait_fish.png`, `rock_coal.png`, `temple_sheet.png`), и запустите:

    npm run prep-assets

Готовые файлы появятся в assets/world и assets/ui; игра подхватит их при следующей сборке без правки кода.
Пока файла нет, используется процедурный плейсхолдер.
