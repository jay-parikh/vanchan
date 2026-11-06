# Vanchan

An offline web app that turns a book (PDF, EPUB or Markdown) into short
swipeable cards, built for Gujarati books. Everything runs in the browser;
books stay on the device. Hosted on Netlify at vanchan.netlify.app.

```
app/       the web app — this folder is what gets deployed (see app/README.md)
tests/     book-text and browser smoke tests (see tests/README.md)
build.sh   runs all tests, then makes ../vanchan.zip for Netlify drop
```

## Releasing

1. Raise `VERSION` in `app/sw.js` (once per release). If the change alters
   the text or cards a book produces, also raise `PARSER` in `app/js/app.js`.
2. Run `./build.sh`. It stops if any test fails.
3. Look at the screenshots in `tests/shots/`.
4. Drop `vanchan.zip` (or the `app` folder) on the site's Deploys page in
   Netlify. Each deploy uses free-plan credits, so batch changes into one
   release. Don't link the site to this repo with automatic deploys, or
   every push would deploy.
