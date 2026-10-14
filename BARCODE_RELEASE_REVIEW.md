# FoodOS v0.2.2 — barcode entry review

Prepared separately from deployed v0.2.1 commit `08c808cb03772dfd7c9f7667a4072185f454289b`.
This package has not been uploaded, committed to the live repository, or deployed.
No production household, inventory, Supabase settings, or migrations were changed.

## Resulting behavior

- Add Food offers rear-camera scanning and typed grocery barcodes.
- EAN-8, UPC-A, EAN-13, and GTIN-14 numbers are validated without losing leading zeroes. Compressed UPC-E barcodes are not supported in this release.
- Open Food Facts API v3 looks up a product name, brand, and package size. Product records are community supplied; the user must review the match against the actual package.
- Scanning or looking up a product never writes inventory.
- Missing products, missing names, offline operation, errors, and timeouts allow manual food-name entry. A valid looked-up barcode is retained even without a match.
- Saving requires a food name, positive quantity, selected unit, selected storage location, and an explicit review check. Changing reviewed fields clears that check. Repeated save calls cannot create duplicate simultaneous events.
- Barcode and lookup provenance are stored in the existing `inventory_events.metadata` through the unchanged `record_inventory_event` RPC. The `products` table is not populated; no schema migration is required. Existing inventory projection, correction, and undo behavior is preserved.
- Camera permission is requested only after pressing Scan. Frames stay in the browser; only the barcode is sent to Open Food Facts. Stop, navigation, a hidden page, a successful scan, or timeout stops the scanner.
- The scanner is bundled locally so its code is available offline. Lookup requires internet; typed manual entry remains available offline, while cloud saves still require the existing backend connection.
- The service worker uses a v0.2.2 cache, retires only old FoodOS caches, and fetches app assets from the network when online. External product requests and authentication tokens are not added to its cache.

## Files

Modified: `index.html`, `src/app.js`, `sw.js`.
Added: `src/barcode.js`, bundled ZXing scanner and license notices, barcode integration tests and a synthetic barcode image fixture, this review note.
`config.js`, the original SQL migration, and the Pages workflow are unchanged.

## Validation

Run `node tests/architecture.test.js` and `node tests/barcode.integration.test.js`.
The integration test uses Playwright in an isolated local browser with a mocked household and RPC; it does not access any real user data. Set `FOODOS_TEST_BROWSER` if a Chrome executable is installed outside Playwright's default cache. It requires Playwright; the Work runtime resolves it through `CODEX_PRIMARY_RUNTIME_NODE_MODULES`.

Browser checks cover matched/unknown/nameless/unavailable products, invalid check digits, stale responses, unsafe product strings, mandatory review and quantity/storage, metadata preservation, duplicate-save protection, manual entry, real EAN decoding from a synthetic image, camera callback success/cancellation/permission denial, mobile width, service worker cache retirement, and offline scanner availability.
A live public API request also verified that the v3 endpoint is reachable and returns the requested product code and name.

Still required: an actual iPhone Safari camera check with a physical package. Camera control tests used mocks; real-device optics and browser permission behavior are not verified. No authenticated production write was tested.

## Dependencies and data

- Bundled `@zxing/browser` 0.1.5, downloaded from its versioned npm CDN package; MIT license in `vendor/ZXING-BROWSER-LICENSE.txt`.
- Bundled ZXing core: Apache 2.0 license in `vendor/ZXING-LIBRARY-LICENSE.txt`.
- Open Food Facts product database: ODbL, attributed in the product lookup interface. No product database or product images are bundled.
- Scanner API: https://github.com/zxing-js/browser
- Product API: https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/

## Approval gate

Deploy only after Chris explicitly approves this v0.2.2 review package. Use the existing GitHub web interface and preserve the verified v0.2.1 commit for rollback. GitHub Actions will inject the existing public Supabase configuration. Do not rerun any SQL migration.
For an existing installed PWA, reopen/reload after the new worker activates to see the updated Add Food interface.
