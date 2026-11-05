/**
 * Long-form content that a gallery item can open into instead of the photo
 * lightbox. Any item with an `article` gets the article treatment: the image
 * lands as the hero, and the text rises in underneath it.
 */

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "quote"; text: string }
  | {
      type: "image"
      src: string
      width: number
      height: number
      caption?: string
    }

export interface Article {
  title: string
  /** Short facts row under the title — role, timeline, team, etc. */
  meta?: { label: string; value: string }[]
  blocks: Block[]
}

const LOREM_A =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur."
const LOREM_B =
  "Quisque faucibus ex sapien vitae pellentesque sem placerat. In id cursus mi pretium tellus duis convallis. Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas. Iaculis massa nisl malesuada lacinia integer nunc posuere."
const LOREM_C =
  "Ut hendrerit semper vel class aptent taciti sociosqu. Ad litora torquent per conubia nostra inceptos himenaeos. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."

/** Placeholder case-study skeleton: overview → problem → process → outcome. */
function caseStudy(inline: Block): Block[] {
  return [
    { type: "p", text: LOREM_A },
    { type: "p", text: LOREM_B },
    { type: "h2", text: "The problem" },
    { type: "p", text: LOREM_C },
    { type: "p", text: LOREM_A },
    inline,
    { type: "h2", text: "Process" },
    { type: "p", text: LOREM_B },
    {
      type: "quote",
      text: "A pull quote or key insight from research goes here.",
    },
    { type: "p", text: LOREM_C },
    { type: "h2", text: "Outcome" },
    { type: "p", text: LOREM_A },
    { type: "p", text: LOREM_B },
  ]
}

const META = [
  { label: "Role", value: "Lead designer" },
  { label: "Timeline", value: "10 weeks" },
  { label: "Team", value: "PM, 2 eng" },
]

export const ARTICLES = {
  gion: {
    title: "Example article title",
    meta: META,
    blocks: caseStudy({
      type: "image",
      src: `${import.meta.env.BASE_URL}photos/nagoya_skytree.jpg`,
      width: 1441,
      height: 1441,
      caption: "Inline images sit on the reading column",
    }),
  },
  field: {
    title: "Example case study with a wide hero",
    meta: META,
    blocks: caseStudy({
      type: "image",
      src: `${import.meta.env.BASE_URL}photos/tori_in_leaves.jpg`,
      width: 1440,
      height: 961,
      caption: "Wide images span the column",
    }),
  },
  studio: {
    title: "Example case study with a tall hero",
    meta: META,
    blocks: caseStudy({
      type: "image",
      src: `${import.meta.env.BASE_URL}photos/glassanimals.jpg`,
      width: 1442,
      height: 1442,
      caption: "Supporting image",
    }),
  },
} satisfies Record<string, Article>
