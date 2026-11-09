# Vanchan – book cards

An offline web app that turns a book (PDF, EPUB or Markdown) into Inshorts-style cards:
one card per sub-topic, shown in random order. Swipe up for the next card, down
for the previous one. Built for Gujarati, works for any language.

Everything runs in the browser. Books are stored on the device (IndexedDB) and
are never uploaded.

## Deploy to Netlify

No build step. Either:

- **Drag and drop:** open https://app.netlify.com/drop and drop this folder
  (or `vanchan.zip`).
- **Git:** push this folder to a repo and create a Netlify site from it. Leave
  the build command empty; the publish directory is `.` (set in `netlify.toml`).

HTTPS (which Netlify gives you) is needed for offline mode and "Add to Home Screen".

## Install on a phone or iPad

- **iPhone / iPad (Safari):** open the site, tap Share, then **Add to Home Screen**.
  Open it from the home-screen icon after that. iOS keeps the books of a
  home-screen app separately from Safari, so add your books from inside the app.
- **Android (Chrome):** open the site and tap **Install app** (in the ⋮ menu, or
  the button in the app's Aa settings).

After the first visit the app works without internet, including adding books.

## What it does with a book

- **EPUB:** reads the chapters in spine order. `h1` headings become the chapter,
  shorter numbered headings such as "(સૂત્ર - ૧)" become the small label, and the
  last heading before the text becomes the card title. Printed page markers such
  as "(પા. ૬)" are skipped.
- **Markdown (.md):** a single `#` title at the top is the book title, `##`
  headings are chapters and `###` headings the card titles (without that
  title, `#` is the chapter). Bold, links and other formatting are dropped;
  list items and table rows stay on one card. `.txt` files are read the same
  way, because iPhone and iPad offer `.md` files as plain text.
- **PDF:** rebuilds lines, columns, paragraphs and headings from the text
  positions, drops running headers, page numbers and contents pages, and treats
  lines in a larger or different display font as headings.
- **Old Gujarati fonts in PDFs:** PDFs typeset with the Krishna / Chitra /
  Girdhar / Dwarika font family store Gujarati as Latin letters. `js/gujlegacy.js`
  converts that to Unicode (glyph table, short-i and reph reordering, half
  letters). Checked against the publisher's EPUB of the same books: 99.8% of
  words match. PDFs in a different old font are refused with a message
  rather than shown garbled.
- **Numbered sayings** (e.g. આપ્તસૂત્ર "૩૭ …"): each number becomes its own card.
- **Long sections** (over ~1000 words) are split into parts that stay together
  and in order, even in random mode.
- **Page numbers:** every card shows the book's printed page ("Page ૨૭"). For
  PDFs it is worked out from the page numbers printed in the running headers
  or footers; tap it to open that page of the original PDF (zoom, previous /
  next page, works offline). For EPUBs it comes from the "(પા. ૬)" page markers.
  Pages without a printed number show the PDF page instead.
- **Contents:** each book has an index of its chapters and sub-topics with
  page numbers. Open it by tapping the book band at the top of a card, from
  the card's ⋯ menu, or from the book in the Library. Tapping an entry starts
  reading at that sub-topic and continues in book order. While reading in book
  order, the shuffle button on the card (or "Back to random cards" in ⋯)
  returns to the random cards where you left them.
- **Running headers and footers** are removed, including section headers that
  change from chapter to chapter (e.g. "(૨) બુદ્ધિનું સ્વરૂપ ૨૭"): a line at the
  top or bottom of a page that carries that page's printed number is dropped.
- Scanned PDFs (pages that are only images) have no text and can't be read.
- **Text fixes reach books already added.** The app keeps each book's
  original file. When a new version reads books better (see `PARSER` in
  `js/app.js`), it reads the stored original again in the background on the
  next start and shows "Text updated in …". Saved, read and hidden cards and
  the reading place are kept. Only books added before their original was kept
  (EPUB and Markdown before v9, PDFs before v3) would need adding again.

## Reading features

Random or book order · contents index · search · page number and original page · unread cards first · saved cards · share / copy ·
hide a card · text size, serif or sans Gujarati font, light / sepia / dark
theme · position remembered per book · arrow keys and mouse wheel on desktop.

## Sync across devices (optional)

Off by default; while off the app never contacts any server. In **Aa →
Sync across devices** the reader switches it on and signs in with Google.
Every device with sync on then keeps the same books (the original files),
read / saved / hidden cards, and the place in each book. When another device
read further, a "Continue from …" message offers to go there.

- Data lives in your own Supabase project (`js/config.js` holds its URL and
  publishable key; `null` there hides the switch). One-time setup:
  `../setup/README.md`.
- Switching off stops sync on that device and keeps everything on it. Sign
  out also forgets the Google account there.
- With sync on, deleting a book deletes it on all devices.
- Text size, font and theme stay per device.
- Netlify is not involved: sync uses no Netlify credits.

## Highlights, notes and pen

- **Words:** select them, then tap **Highlight** (your last colour) or **Note**.
  Tap a highlight to change its colour (4), add or remove an underline, open
  its note, or remove it. A highlight can run across paragraphs.
- **Notes:** one sheet, **Type** or **Write by hand** (lined paper with pen,
  eraser and undo). It remembers which one you used last. Notes go on
  selected words, or on the whole card with ⋯ → "Note on this card".
- **Pen on a card:** the pen button in the card's footer. Pen, Highlight,
  Eraser, Undo and Done; tap Pen again for its colours. A card you draw on
  keeps the text size, font and width it was drawn at, so the marks stay on
  their words.
- **Pen on a PDF page:** the pen button in the page viewer, with the same
  tools. The marks stay put when you zoom.
- **Saved → Highlights & notes:** everything you marked, by book. "Send to
  Notes…" shares a book's highlights and notes as text (Apple Notes, Mail…).
- **Wide screens** (desktop, iPad landscape): the book's contents on the left
  and this card's highlights and notes on the right. Each folds into a slim
  rail (« »), giving the card up to 860px; the choice is kept per device.
- **Moving around while the pen is on:** the pen bar starts with a
  **Move | Draw** switch. Move: one finger scrolls; Draw: one finger draws.
  Two fingers always scroll. With an Apple Pencil, the pencil draws and a
  finger scrolls.
- **Printed index:** a book's own index page (અનુક્રમણિકા) becomes a card in
  book order; tap an entry to open that topic.
- With sync on, all of this syncs (needs the marks table: `../setup/README.md`).

## Search

The magnifier in the top bar searches card titles and text. A card is found
when it holds every word typed, in any order; case and invisible joiner
characters are ignored. While reading one book it searches that book, with a
switch to search all books. Tap a result to open the card with the words
highlighted.

## Updating the app

When a change alters the text or cards a book produces, also raise `PARSER`
in `js/app.js`, so books already added are read again.

Build with `../build.sh`: it runs both test suites in `../tests` and makes
`vanchan.zip` only when they pass.

When you change any file, also change `VERSION` in `sw.js` (currently `vanchan-v13`).
The app looks for a new version each time it is opened or brought back to the
screen, downloads it, and reloads itself into it ("App updated"). Books,
reading progress and settings are kept. There is no need to remove and add
the home-screen app again.

Phones that still have v5 or older do not have this check yet. After the
first deploy of v6, close the app fully (swipe it away in the app switcher)
and open it again; if it still looks old, do that once more. From then on
updates arrive by themselves.

## Files

```
index.html            page
css/app.css           styles
js/app.js             feed, swiping, library, settings, import
js/cards.js           blocks → cards
js/epubbook.js        EPUB → blocks
js/mdbook.js          Markdown → blocks
js/pdfbook.js         PDF → blocks (layout)
js/gujlegacy.js       old Gujarati font → Unicode
js/db.js              IndexedDB storage
sw.js                 offline cache
vendor/               pdf.js 3.11.174 (legacy build), JSZip 3.10.1
fonts/                Noto Serif / Sans Gujarati (variable, Gujarati subset)
icons/                app icons
```

Third-party licences are listed in `vendor/THIRD-PARTY.txt`.
