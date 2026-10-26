# Example — Diesel to Syria (owner's working files, Oct 2026)

Two Excel files sent by the owner. Raw files are not stored in the repository (they contain driver names, plates and phone-level personal data); this note records their structure and rules.

## File 1: `DIESEL 26-10.xlsx` — the job's master sheet (one row per trip/manifest)

Sheet `evercrest`, 197 trips loaded 13–20 Oct 2026. Header row 1 (Arabic/Kurdish) splits the sheet in steps:
1. **Daily at loading (A–N):** driver info, cash advance, price and reward, transporter, quantity.
2. **When the driver returns with the manifest (O–AC):** fill white cells only; coloured cells are formulas.
3. **Syrian border expenses with commission (AD–AL).**
4. **Customs (AM–AO).** 5. **Final (AP).**

| Col | Header | Meaning | Values seen |
|---|---|---|---|
| A | بەرواری بارکردن | loading date | 13–20 Oct |
| B | محور | route/axis | Erbil–Syria (85), Erbil–Latakia (61), Erbil–Homs (51) |
| C | شوێنی بارکردن | loading place | Kawergosk – Erbil (all) |
| D | شوێنی بەتاڵکردن | discharge place | Banias – Syria (all) |
| E | نرخ تەن | price per ton paid to driver (USD) | 70 (193), 75 (4) |
| F | بخشیش | reward per trip | 0 |
| G | عمولە ناقل | transporter commission per ton | 0 |
| H | سلف | cash advance to driver (USD) | 900 (184), 300 (6), 0 (7) |
| I | کۆمپانیا | "company" | Ever crest 93, Rekan 56, Amanj 35, QZL 9, Dazzle 3, darawan 1 — **meaning to confirm** |
| J | ناقل | transporter | 12 different |
| K, L | ناو سایەق, ژ. سەیارە | driver name, plate | 197 different each (one trip per truck in this file); a plate cell can hold two plates (truck + trailer) |
| M | رقم منفیست | manifest no. | e.g. H-151 |
| N | بڕی بارکراو | loaded tons | ~30–31 |
| O | بەرواری بەتاڵکردن | discharge date | missing on 146 of 197 |
| P | بڕی بەتاڵکراو | discharged tons | missing on 85 of 197 |
| Q | نقص | shortage = P − N (negative = loss) | formula |
| R | سماح | allowance (tons) | −0.15 |
| S | نقص دوای سماح | shortage beyond allowance = IF(Q<R, Q−R, 0) | formula |
| T | نرخ غرامە | fine price per ton (USD) | 1200 |
| U | مجموع غرامە | fine = T × S (negative) | formula |
| V | طن صافی | net tons = MIN(loaded, discharged) | formula |
| W | پارەی ناقل | transporter money = V × G | formula (0 here) |
| X | لێبڕینی ڤیزا - تآمین | visa/insurance deducted from driver | 0 or blank |
| Y | لێبڕینی ناقل | deduction for the transporter (moves to transporter's account) | 50 on 27 trips |
| Z | کۆی گشتی پارەی سایەق | driver total = V×E + F + W + U − X − Y | formula |
| AA | بڕی پێویست خەرجبکرێ بۆ سایەق | amount still to pay = Z − H | formula |
| AB, AC | رقم/تآریخ مطالەبە | transporter claim no./date | e.g. BR-1, EC-1, RK-1, RK-2 |
| AD | تاریخ صرف | date the border expenses were paid | |
| AE | کفالە | guarantee | 100 (163), 0 (34) |
| AF | تآمین | insurance | 75 (163), 0 (34) |
| AG | فیزا | visa | 50 |
| AH | فیشە دخول | entry slip | 50 |
| AI | رسم بیان | declaration fee | 70 |
| AJ | کۆی گشتی حدود بێ عمولە | border total without commission = AE+AF+AG+AH+AI | 345 or 170 |
| AK | عمولە حدود | border commission | 10 |
| AL | کۆی گشتی مصرف بار بێ گومرگ | load cost without customs = AJ + Z + AK | formula |
| AM | تەنی گومرگ | customs tons | blank |
| AN | نرخی ١ تەن گومرگ | customs price per ton | 30 |
| AO | کۆی گشتی گومرگ | customs total = AN × N (loaded tons) | formula |
| AP | کۆی گشتی مصرف دوای گومرگ | total cost incl. customs = AO + AL | formula |

Row 2 holds SUBTOTAL totals (so filters give per-transporter/per-claim totals).

Other sheets: `Sheet2` = empty cash-box template (date, in, out, balance, note). `Sheet1` = one stray row from a different job (Basra → Aqaba, Jordan; black/crude; company Dazzle; driver nationality; status "arrived"; loaded 29.2, discharged 29.74 i.e. a gain; allowance −0.2; fine price 650; a 15-digit number of unknown meaning) — shows other jobs use more columns (status, nationality, route by country).

## File 2: transporter settlement form ("فۆڕمی تسویەی مطالەبەی ناقل - گاز سوریا")

One sheet per transporter claim (e.g. `Ec - 1`), printed on one A4 page and signed by: prepared by / reviewed by / accountant.
- Header: transporter, claim no. (EC-01), claim date, route, allowance (−0.15), fine price (1200), number of trucks, total net tons, **amount to pay (to transporter / driver)**.
- One line per manifest: loading date, manifest, driver, plate, loaded, discharged, net = MIN, price/ton, freight = ROUND(net × price, 2), reward, fine = IF(ROUND(dis−load,3) < allowance, ROUND((dis−load−allowance) × 1200, 2), 0), visa/insurance deduction, deduction for transporter, driver total = freight + reward + fine − visa/ins − deduction, advance, to pay = total − advance, border total, load cost without customs = driver total + deduction + border total.
- Summary block explains step by step how the amount to pay is reached.
- Instructions sheet (Kurdish): copy the sheet for each claim, name it by claim no., fill white cells only, take numbers from the master DIESEL file for the same manifest, add rows if more than 20 trips, print and sign before sending to the accountant.

## Rules confirmed by the files (USD)

- Net tons = min(loaded, discharged). Freight = net × price per ton (rounded to cents on the form).
- Shortage fine only beyond the allowance: (discharged − loaded − allowance) × fine price, when discharged − loaded < allowance (−0.15 t). Gains are not paid.
- Driver total = freight + reward + transporter money − fine − visa/insurance deduction − deduction for transporter. To pay = driver total − advance.
- "Deduction for transporter" lowers what the driver gets and is credited to the transporter's account; it is **not** a saving for the company.
- Company cost per trip = driver total + deduction for transporter + border costs (+ border commission) + customs (customs price × loaded tons).
- Settlement is grouped by **transporter claim** (مطالەبە): a claim number covers several manifests of one transporter.

## Inconsistencies found in the files (to confirm with the owner)

1. **Company cost misses the transporter deduction in the master file.** Master: AL = border + driver total + commission (no Y). Settlement form: cost = driver total + deduction + border. With Y = 50 on 27 trips, the master file understates cost by 1,350 USD.
2. **Border commission:** master AL adds AK (10); the form's border total uses 345/170 (without commission) although its instructions say the border total includes the commission.
3. **Customs tons:** AO uses loaded tons (N), while column AM "customs tons" exists but is empty — which quantity is customs charged on?
4. **Transporter money (W = net × G)** is added to the driver's total in the master file but has no column on the settlement form.
5. **Rounding:** the form rounds freight and fine to cents and the shortage to 3 decimals; the master file does not round — totals can differ by cents.

## Open questions from these files

- EX-Q1 Column I "company" (Ever crest, Rekan, Amanj, QZL, Dazzle, darawan): who are these — our partner companies, sub-contractors, or the company the truck works under? Claim prefixes (EC, RK, BR) seem related.
- EX-Q2 Is the customer price (what the customer pays us per ton) in another file? This file only has driver-side money and our costs.
- EX-Q3 Who pays border costs (kafala, insurance, visa, entry slip, declaration fee): we pay at the border and they are our cost; when is visa/insurance deducted from the driver instead (column X)?
- EX-Q4 Why are kafala and insurance 0 on 34 trips (170 instead of 345)?
- EX-Q5 Currency: all USD? Are advances paid in USD cash, and border costs in USD?
- EX-Q6 Where are the 146 trips with no discharge date — still on the road, or discharged but papers not back?
