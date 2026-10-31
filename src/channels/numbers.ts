// Sarvam bulbul:v3 normalises numbers itself, but in Hinglish with ₹ it reads "3,321"
// digit by digit. Voice text gets amounts written out as words before TTS; the
// WhatsApp text keeps the digits.

// Hindi 0-99 are irregular, so they are a table, not rules.
const HI = "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरेपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरेसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उनासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे".split(" ");
const EN = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const EN_TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

const en99 = (n: number) => (n < 20 ? EN[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN[n % 10]}` : ""));

// Indian grouping: crore, lakh, thousand, hundred.
export function inWords(n: number, lang: "hi" | "en"): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  const small = lang === "hi" ? (x: number) => HI[x] : en99;
  if (n < 100) return small(n);
  const scales: [number, string, string][] = [
    [10_000_000, "करोड़", "crore"],
    [100_000, "लाख", "lakh"],
    [1_000, "हज़ार", "thousand"],
    [100, "सौ", "hundred"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, hi, en] of scales) {
    if (rest < size) continue;
    const q = Math.floor(rest / size);
    parts.push(`${q >= 100 ? inWords(q, lang) : small(q)} ${lang === "hi" ? hi : en}`);
    rest %= size;
  }
  if (rest) parts.push(lang === "en" && n > 100 ? `and ${small(rest)}` : small(rest));
  return parts.join(" ");
}

// "₹3,321" / "3,321 rupaye" / "Rs 500" → words + rupees. Bare numbers of 3+ digits too;
// times (10:43), dates (2026-10-31) and short numbers are left for the TTS.
export function speakable(text: string, lang: "hi" | "hinglish" | "en") {
  const l = lang === "en" ? "en" : "hi";
  const rupees = l === "hi" ? "रुपये" : "rupees";
  return text
    .replace(/(?:₹|\bRs\.?\s?|\bINR\s?)\s?(\d[\d,]*)(?:\s*(?:rupaye|rupees|rupee|रुपये|रुपए))?/gi, (_, d) => `${inWords(Number(d.replace(/,/g, "")), l)} ${rupees}`)
    .replace(/(?<![\d:/-])\b(\d{1,3}(?:,\d{2,3})+|\d{3,})\b(?![\d:/-])/g, (d) => inWords(Number(d.replace(/,/g, "")), l));
}
