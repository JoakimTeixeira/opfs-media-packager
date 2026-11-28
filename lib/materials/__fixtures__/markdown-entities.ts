import type { TiptapNode } from "../topic-markdown.ts";

export const entityReferences = new Map([
  [
    "sgid-1",
    {
      title: "Aula de Exemplo",
      url: "https://training.example/c/community/sample-lesson",
    },
  ],
  [
    "sgid-empty-title",
    {
      title: "",
      url: "https://training.example/c/community/sem-titulo",
    },
  ],
  [
    "sgid-embed-yt",
    {
      title: "Sample Tech Talk",
      url: "https://youtu.be/vid33333333?rel=0",
    },
  ],
  [
    "sgid-embed-post",
    {
      title: "Sessões da Comunidade",
      url: "https://training.example/c/events/preview-post",
    },
  ],
]);

export const entityAndCtaDoc: TiptapNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "entity", attrs: { sgid: "sgid-1" } },
        { type: "text", text: " e " },
        {
          type: "entity",
          attrs: { sgid: "sgid-missing", label: "Fallback Entity" },
        },
        { type: "text", text: " e " },
        { type: "entity", attrs: { sgid: "sgid-empty-title" } },
      ],
    },
    {
      type: "cta",
      attrs: {
        button_text: "Preencher Feedback",
        url: "https://forms.example/feedback",
      },
    },
    {
      type: "cta",
      attrs: {
        href: "/c/curso/proxima",
      },
    },
    {
      type: "embed",
      attrs: {
        title: "Architecture Video",
        src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    },
    {
      type: "embed",
      attrs: { sgid: "sgid-embed-yt" },
    },
    {
      type: "embed",
      attrs: { sgid: "sgid-embed-post" },
    },
  ],
};
