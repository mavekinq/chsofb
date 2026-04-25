export interface CelebiNewsItem {
  title: string;
  url: string;
  summary: string;
}

const FALLBACK_CELEBI_NEWS: CelebiNewsItem[] = [
  {
    title: "ÇELEBİ HAVA SERVİSİ ANONİM ŞİRKETİ YÖNETİM KURULU BAŞKANLIĞI’NDAN Olağan Genel Kurul Toplantısına Davet",
    url: "https://www.celebiaviation.com/tr/medya/haberler/olagan-genel-kurul-toplantisina-davet",
    summary: "Şirketimizin 2025 hesap dönemi muamelatından dolayı yıllık Olağan Genel Kurul toplantısı 16 Nisan 2026 tarihinde İstanbul'daki şirket genel merkezinde yapılacaktır.",
  },
  {
    title: "Çelebi Havacılık, 40,1 Milyon Dolarlık Transglobal Cargo Centre Satın Alımıyla Kenya Pazarına Giriyor",
    url: "https://www.celebiaviation.com/tr/medya/haberler/celebi-havacilik-kenya-pazarina-giriyor",
    summary: "Çelebi Havacılık, Transglobal Cargo Centre Ltd. satın alımıyla Kenya havacılık hizmetleri pazarına giriş yaptı ve küresel büyüme stratejisini güçlendirdi.",
  },
  {
    title: "Çelebi Havacılık, Kualanamu’daki Yeni Kargo Terminaliyle Endonezya’daki Varlığını Güçlendiriyor",
    url: "https://www.celebiaviation.com/tr/medya/haberler/celebi-havacilik-kualanamu-yeni-kargo-terminaliyle-endonezya-varligini-guclendiriyor",
    summary: "Çelebi Havacılık, Endonezya'nın Kualanamu Uluslararası Havalimanı'ndaki yeni kargo terminalinde operasyonlarına başlayarak bölgedeki büyümesini ileri taşıyor.",
  },
  {
    title: "Evrim Ünal Gökce, Oksijen Gazetesi'nin \"Bugünün ve Yarının Kadın Liderleri\" Projesinde Havacılıkta Kadın Olmayı Anlattı",
    url: "https://www.celebiaviation.com/tr/8-mart-dunya-kadinlar-gunu",
    summary: "Çelebi Havacılık İnsan Kaynakları Kıdemli Başkan Yardımcısı Evrim Ünal Gökce, havacılık sektöründe kadın istihdamı ve liderlik üzerine değerlendirmelerini paylaştı.",
  },
];

const CELEBI_NEWS_SOURCE_URL = "https://www.celebiaviation.com/tr/medya/haberler";
const CELEBI_NEWS_PROXY_URL = `https://r.jina.ai/http://${CELEBI_NEWS_SOURCE_URL.replace(/^https?:\/\//, "")}`;

const cleanText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\*+/g, "")
    .trim();

const clampSummary = (value: string, maxLength = 220) => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
};

export const parseCelebiNews = (markdown: string) => {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: CelebiNewsItem[] = [];
  const seenUrls = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const titleMatch = line.match(/^\*\*\[([^\]]+)\]\((https:\/\/www\.celebiaviation\.com\/tr\/[^)]+)\)\*\*$/);
    if (!titleMatch) {
      continue;
    }

    const [, rawTitle, url] = titleMatch;
    if (seenUrls.has(url)) {
      continue;
    }

    let summary = "";
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (nextLine.startsWith("**[") || nextLine.startsWith("[![Image")) {
        break;
      }

      if (!nextLine.startsWith("[") && nextLine.length > 40) {
        summary = cleanText(nextLine);
        break;
      }
    }

    if (!summary) {
      continue;
    }

    seenUrls.add(url);
    items.push({
      title: cleanText(rawTitle),
      url,
      summary: clampSummary(summary),
    });
  }

  return items;
};

export const fetchCelebiNews = async (limit = 4) => {
  try {
    const response = await fetch(CELEBI_NEWS_PROXY_URL);
    if (!response.ok) {
      return FALLBACK_CELEBI_NEWS.slice(0, limit);
    }

    const markdown = await response.text();
    const parsedItems = parseCelebiNews(markdown).slice(0, limit);
    return parsedItems.length ? parsedItems : FALLBACK_CELEBI_NEWS.slice(0, limit);
  } catch {
    return FALLBACK_CELEBI_NEWS.slice(0, limit);
  }
};

export { CELEBI_NEWS_SOURCE_URL };