import type { ItemCompanionDocuments } from "../item-assets.ts";

export const postNoteMaterials: ItemCompanionDocuments = {
  markdown: "# Post 1\n\nRepo [link](https://github.com/org/repo)\n",
  images: [
    {
      kind: "image",
      url: "https://assets.example/rails/active_storage/blobs/redirect/sig1/pic.png",
      filename: "pic.png",
    },
  ],
  pdfs: [],
  diagrams: [
    {
      kind: "diagram",
      url: "https://app.excalidraw.com/l/room/1",
      title: "Dup diagram",
    },
    {
      kind: "diagram",
      url: "https://app.excalidraw.com/l/room/2",
      title: "New diagram",
    },
  ],
  slides: [],
  extraNotes: [
    { title: "Blank skipped", markdown: "   " },
    { title: "No url note", markdown: "# Extra body\n" },
    { title: "No url note", markdown: "# Extra body\n" },
  ],
};
