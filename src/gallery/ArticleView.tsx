import type { Article, Block } from "./articles"

interface Props {
  article: Article
  index: number
  articleRef: (el: HTMLElement | null) => void
}

/**
 * The text half of an article. The hero is *not* in here — it's the gallery
 * card itself, flown into place by the controller — so this element is just
 * the column that sits under it. The controller owns its position (it rides
 * the `read` scroll spring together with the hero) and reveals each
 * `[data-part]` in turn as the open spring lands.
 */
export function ArticleView({ article, index, articleRef }: Props) {
  const titleId = `article-${index}-title`
  return (
    <article
      ref={articleRef}
      data-article={index}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="absolute top-0 left-0 z-20 cursor-auto outline-none select-text"
      style={{ visibility: "hidden", transform: "translate3d(-9999px,0,0)" }}
    >
      <header data-part>
        <h1
          id={titleId}
          className="text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[32px]"
        >
          {article.title}
        </h1>
        {article.meta && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px]">
            {article.meta.map((m) => (
              <div key={m.label} className="flex gap-2">
                <dt className="text-muted-foreground">{m.label}</dt>
                <dd className="text-foreground">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>
      <div
        data-part
        className="mt-8 flex flex-col gap-5 text-[17px] leading-[1.75] text-pretty text-muted-foreground sm:text-[18px]"
      >
        {article.blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
      </div>
    </article>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return <p>{block.text}</p>
    case "h2":
      return (
        <h2 className="mt-6 text-[19px] leading-snug font-semibold tracking-[-0.01em] text-foreground sm:text-[21px]">
          {block.text}
        </h2>
      )
    case "quote":
      return (
        <blockquote className="my-2 border-l-2 border-foreground pl-5 text-[20px] leading-[1.5] text-foreground sm:text-[22px]">
          {block.text}
        </blockquote>
      )
    case "image":
      return (
        <figure className="my-4 flex flex-col items-center gap-3.5">
          <img
            src={block.src}
            alt=""
            width={block.width}
            height={block.height}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-auto w-full rounded-[6px] bg-muted"
          />
          {block.caption && (
            <figcaption className="font-mono text-[11px] text-muted-foreground">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )
  }
}
