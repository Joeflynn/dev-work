import { ARTICLES, type Article } from "./articles"

export interface Photo {
  src: string
  title: string
  /** When present, opening this item reads as an article, not a lightbox. */
  article?: Article
  /** Natural pixel size — the aspect ratio is preserved in every layout. */
  width: number
  height: number
}

/** Images from ~/Documents/Photography, copied into public/photos. */
export const PHOTOS: Photo[] = [
  {
    src: `${import.meta.env.BASE_URL}photos/katerina_in_the_studio.jpg`,
    title: "Katerina in the studio",
    width: 1441,
    height: 2159,
    article: ARTICLES.studio,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/ethan_shades.jpg`,
    title: "Ethan, shades",
    width: 1441,
    height: 1441,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/tj_field.jpg`,
    title: "TJ, field",
    width: 1443,
    height: 954,
    article: ARTICLES.field,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/slu_architecture.jpg`,
    title: "SLU architecture",
    width: 1441,
    height: 2160,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/Gion-Crowded.jpg`,
    title: "Gion, crowded",
    width: 1440,
    height: 1440,
    article: ARTICLES.gion,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/katerina_street.jpg`,
    title: "Katerina, street",
    width: 1439,
    height: 2162,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/tori_in_leaves.jpg`,
    title: "Tori in leaves",
    width: 1440,
    height: 961,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/nagoya_skytree.jpg`,
    title: "Nagoya, Skytree",
    width: 1441,
    height: 1441,
  },
  { src: `${import.meta.env.BASE_URL}photos/aspca_guy.jpg`, title: "ASPCA", width: 1441, height: 2159 },
  {
    src: `${import.meta.env.BASE_URL}photos/glassanimals.jpg`,
    title: "Glass Animals",
    width: 1442,
    height: 1442,
  },
  {
    src: `${import.meta.env.BASE_URL}photos/yo_bumpershoot.jpg`,
    title: "Yo, Bumbershoot",
    width: 1441,
    height: 1441,
  },
]
