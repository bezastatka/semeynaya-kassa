# Семейная касса

Учёт трат и доходов для себя и всей семьи: личные и общие счета, кошельки, переводы, цели, долги, лимиты по категориям, прогноз, регулярные платежи, история и статистика. Работает как сайт, устанавливается на телефон как PWA и собирается в приложения для iOS и Android.

## Как устроено

- **Веб-часть** — статические файлы (HTML, CSS, JS) без фреймворков и сборщиков. Одна и та же папка `dist/` выкладывается на хостинг и попадает внутрь приложений.
- **Приложения для телефона** — [Capacitor](https://capacitorjs.com): проекты `android/` и `ios/`. На телефоне добавляются вход по Face ID / отпечатку, вибрация, «Поделиться», кнопка «Назад» на Android.
- **Данные и вход** — [Supabase](https://supabase.com): база Postgres, вход по почте с кодом, живые обновления.
- **Доступ** — правила в базе (Row Level Security): личные данные видит только владелец, общий счёт — только его участники.

| Файл / папка | Что внутри |
|---|---|
| `index.html`, `app.css` | разметка и оформление |
| `js/config.js` | адрес сайта, адрес проекта Supabase и публичный ключ |
| `js/backend.js` | работа с Supabase, офлайн-очередь, вход |
| `js/native.js` | возможности телефона в приложениях (на сайте ничего не делает) |
| `js/app.js` | интерфейс и логика |
| `js/i18n.js`, `js/i18n-en.js` | языки: русский — исходный, английский — словарь (ключ — русская строка) |
| `js/vendor/`, `css/fonts.css`, `fonts/` | supabase-js и шрифты — лежат в проекте, без внешних CDN |
| `sw.js`, `manifest.webmanifest`, `icons/` | установка сайта на телефон и работа без сети |
| `.htaccess` | настройки сервера Apache: HTTPS, кэш, заголовки безопасности |
| `scripts/build.mjs` | сборка `dist/` |
| `android/`, `ios/`, `capacitor.config.json` | проекты приложений |
| `assets/` | исходники иконки и заставки для приложений (`npx capacitor-assets generate`) |
| `supabase/schema.sql` | таблицы, правила доступа и функции базы |
| `.github/workflows/` | выкладка сайта по FTP и сборка Android |

## Сайт на своём хостинге

1. **GitHub → Settings → Secrets and variables → Actions**:
   - *Secrets*: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` — из панели хостинга;
   - *Variables*: `FTP_DIR` — папка сайта на хостинге со слешем в конце (например, `public_html/`), `SITE_URL` — адрес сайта (`https://ваш-домен`).
2. После каждого изменения в `main` сайт выкладывается сам (вкладка **Actions → Выложить сайт**; запустить вручную — *Run workflow*).
3. На хостинге включите бесплатный SSL-сертификат (Let’s Encrypt) для домена.
4. **Supabase → Authentication → URL Configuration**: в **Site URL** — адрес сайта, в **Redirect URLs** — `https://ваш-домен/**`.

## Приложение для Android

- **Проверка на телефоне**: Actions → **Android** → последний запуск → *Artifacts* → `kassa-debug-apk`, установить APK на телефон.
- **Google Play**: создайте ключ загрузки (Android Studio → *Build → Generate Signed App Bundle → Create new*, или `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`) и добавьте Secrets: `ANDROID_KEYSTORE_BASE64` (`base64 -i upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Тогда сборка дополнительно выдаёт `kassa-release-aab` для загрузки в Play Console. Сам файл ключа храните у себя — в репозиторий его не кладите.
- Локально: `npm ci && npm run android` (откроет Android Studio).

## Приложение для iOS (нужен Mac с Xcode)

```
npm ci
npm run ios          # соберёт веб-часть и откроет проект в Xcode
```

В Xcode: *App → Signing & Capabilities → Team* — ваш аккаунт Apple Developer; затем *Product → Archive → Distribute App → App Store Connect*.

## Обновления

Изменения в веб-части попадают на сайт сразу после выкладки. В приложения — после новой сборки и публикации в сторах (`npm run sync`, затем сборка Android / Archive в Xcode). Перед публикацией увеличьте `version` в `package.json` (Android) и *Version / Build* в Xcode (iOS).

## Перенос данных

В приложении: **Настройки → Аккаунт и резервная копия → Восстановить из файла**. Файл резервной копии — там же, «Скачать копию».
