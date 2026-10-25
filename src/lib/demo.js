// Demo dataset that mirrors the user's real sheet layout:
//   ODD columns (1,3,5,7,9)  = 4-digit numbers (Group A/B matching — red/yellow)
//   EVEN columns (2,4,6,8,10) = expressions like "3*4", "5-2" (always recomputed as +)
//   last row = printed sub-totals "values below the column" (toggle counts them in / out)
// Open the site with ?seed=1 in the URL, or press the button on the empty pages.

export const DEMO_CELLS = [
  ['เลขหนึ่ง', 'รวมหนึ่ง', 'เลขสอง', 'รวมสอง', 'เลขสาม', 'รวมสาม', 'เลขสี่', 'รวมสี่', 'เลขห้า', 'รวมห้า'],
  ['4521', '3*4', '9126', '5+2', '3347', '4*2', '8213', '9-1', '2046', '7+1'],
  ['9024', '7+1', '1132', '2*3', '5567', '6+2', '2048', '8*2', '1350', '4+4'],
  ['1234', '9', '4477', '4+4', '3025', '2*8', '7719', '3+7', '6811', '2'],
  ['6612', '5*5', '9843', '1+2', '2014', '7*1', '4433', '6+2', '5290', '3*3'],
  ['3390', '8', '1247', '3+3', '6721', '5*2', '9056', '4+4', '4177', '6+1'],
  ['2468', '6+1', '4514', '2*2', '8835', '9+1', '3372', '7*1', '7624', '2*8'],
  ['', '49', '', '33', '', '49', '', '54', '', '41'],
]

export const DEMO_NAME = 'ตัวอย่าง: ตารางเลขจริง (คี่=เลข, คู่=นิพจน์)'

// Values verified with the app engine itself (sums per expression column):
//   col2 = 3+4 | 7+1 | 9 | 5+5 | 8 | 6+1 = 49    printed below column: 49
//   col4 = 33, col6 = 49, col8 = 54, col10 = 41  (sub-total row = same values)
// GRAND WITH sub-total row (default ON)  = 452   →  NET −25% = 339
// GRAND WITH sub-total row OFF = 226             →  NET −25% = 169.5
// Try in กลุ่ม A (odd columns, red circles): 521 → 4521 · 34 → 1234 · 48 → 2048
// Try in กลุ่ม B (yellow): 3 digits "132" → perms contain 132/213 → 1132 & 8213 (2 hits)
//   2 digits "46" → perms {46,64} → 2046 (1 hit).
