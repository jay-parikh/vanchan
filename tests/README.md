# Vanchan tests

Smoke and regression tests for `../app`. Not deployed. `../build.sh` runs both
before making the zip; to run them by hand:


```
export PATH=~/node22/bin:$PATH
node parse.js          # every sample book vs. baseline/, word by word
node ui.js             # headless Chromium walk-through of every screen (72 checks)
```

- `parse.js --update` accepts the current output as the new baseline. Use it
  only after reading the listed differences and agreeing with each one.
- The sample books are the PDFs / EPUBs in the folder above (not in git;
  they are the publishers' books). `baseline/` holds their text, so it is not
  in git either; make it again with `--update` from a version known to be good.
- `ui.js` screenshots go to `shots/`. Look at them, not just the PASS lines.
- `.libs/` holds the Ubuntu 16.04 libraries Chromium needs on this VM.
- `APP=/path/to/other/copy node ui.js` tests another copy of the app.
