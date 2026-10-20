# PDF export fonts: sources and licenses

Added 2026-10-20 for the answer PDF export (design audit H14 remainder).
These static TrueType files are fetched only at PDF export time from
`/fonts/ttf/` and embedded into the generated PDF with jsPDF. They are
not part of the main bundle and are not loaded by any other view.

Both families are licensed under the SIL Open Font License 1.1.
Full license text: `OFL.txt` in this folder, plus the per family copies
`OFL-Inter.txt` and `OFL-SourceSerif4.txt` as served by the upstream
projects.

All files were obtained from the Google Fonts API on 2026-10-20.
Requesting a family at a single weight and style from
`fonts.googleapis.com` with an old user agent returns a static
TrueType file on `fonts.gstatic.com`; these are those files, unmodified.
Each file was verified before inclusion: TrueType magic `00010000`,
no `fvar` table (so each file is a static face, not a variable font),
and a name table identifying the family and style below. The italic
and bold italic files carry the italic bit in both `head.macStyle`
and `OS/2.fsSelection`, so they are real italic faces.

## Source Serif 4 (registered in jsPDF as `SourceSerif4`)

| File | Family | Style (jsPDF) | Bytes | Source URL |
| --- | --- | --- | --- | --- |
| SourceSerif4-Regular.ttf | Source Serif 4 | normal (400) | 194464 | https://fonts.gstatic.com/s/sourceserif4/v15/vEFy2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6OAVIJmeUDygwjihdqrhw.ttf |
| SourceSerif4-Bold.ttf | Source Serif 4 | bold (700) | 194760 | https://fonts.gstatic.com/s/sourceserif4/v15/vEFy2_tTDB4M7-auWDN0ahZJW3IX2ih5nk3AucvUHf6OAVIJmeUDygwjivBtrhw.ttf |
| SourceSerif4-Italic.ttf | Source Serif 4 | italic (400) | 183552 | https://fonts.gstatic.com/s/sourceserif4/v15/vEF02_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US2D2QYxoUKIkn98pRl9dCw.ttf |
| SourceSerif4-BoldItalic.ttf | Source Serif 4 | bolditalic (700) | 183648 | https://fonts.gstatic.com/s/sourceserif4/v15/vEF02_tTDB4M7-auWDN0ahZJW1ge6NmXpVAHV83Bfb_US2D2QYxoUKIkn98poVhdCw.ttf |

Upstream: Adobe source serif, https://github.com/adobe-fonts/source-serif
License: SIL Open Font License 1.1 (see OFL-SourceSerif4.txt)

## Inter (registered in jsPDF as `Inter`)

| File | Family | Style (jsPDF) | Bytes | Source URL |
| --- | --- | --- | --- | --- |
| Inter-Regular.ttf | Inter | normal (400) | 324820 | https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf |
| Inter-Bold.ttf | Inter | bold (700) | 326468 | https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf |
| Inter-Italic.ttf | Inter | italic (400) | 328252 | https://fonts.gstatic.com/s/inter/v20/UcCM3FwrK3iLTcvneQg7Ca725JhhKnNqk4j1ebLhAm8SrXTc2dthjQ.ttf |
| Inter-BoldItalic.ttf | Inter | bolditalic (700) | 330132 | https://fonts.gstatic.com/s/inter/v20/UcCM3FwrK3iLTcvneQg7Ca725JhhKnNqk4j1ebLhAm8SrXTcPtxhjQ.ttf |

Upstream: The Inter Project Authors, https://github.com/rsms/inter
License: SIL Open Font License 1.1 (see OFL-Inter.txt)
