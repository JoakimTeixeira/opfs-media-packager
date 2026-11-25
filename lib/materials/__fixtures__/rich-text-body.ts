export const richTextBody = {
  inline_attachments: [
    {
      signed_id: "sig-img-1",
      url: "https://assets.example/rails/active_storage/representations/redirect/sig-img-1/large/arch.png",
      filename: "arch.png",
      content_type: "image/png",
      image_variants: {
        original: "https://assets.example/originals/arch.png",
        large: "https://assets.example/large/arch.png",
        thumbnail: "https://assets.example/thumb/arch.png",
      },
    },
    {
      signed_id: "sig-pdf-1",
      url: "https://assets.example/abc123",
      filename: "architecture-guide.pdf",
      content_type: "application/pdf",
      image_variants: {
        thumbnail:
          "https://assets.example/rails/active_storage/representations/redirect/sig-pdf-1/thumb/architecture-guide.pdf",
      },
    },
    {
      signed_id: "sig-vid-ignored",
      url: "https://assets.example/clip.mp4",
      filename: "clip.mp4",
      content_type: "video/mp4",
    },
    "invalid-entry",
  ],
  attachments: [
    {
      signed_id: "sig-img-2",
      url: "/rails/active_storage/representations/redirect/sig-img-2/med/flow.webp",
      content_type: "image/webp",
    },
    {
      signed_id: "sig-img-variant-only",
      type: "image",
      name: "fallback-pic.jpg",
      image_variants: {
        medium:
          "https://assets.example/rails/active_storage/representations/redirect/sig-img-variant-only/med/fallback-pic.jpg",
      },
    },
    {
      signed_id: "sig-pdf-thumb-fallback",
      filename: "notes.pdf",
      image_variants: {
        thumbnail:
          "https://assets.example/rails/active_storage/representations/redirect/sig-pdf-thumb-fallback/var/notes.pdf",
      },
    },
    {
      signed_id: "sig-empty",
      content_type: "image/png",
    },
    {
      signed_id: "sig-empty-pdf",
      content_type: "application/pdf",
    },
  ],
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ver " },
          {
            type: "text",
            text: "Diagrama ",
            marks: [
              {
                type: "link",
                attrs: { href: "https://app.excalidraw.com/s/flow-1" },
              },
            ],
          },
          {
            type: "text",
            text: "Principal",
            marks: [
              { type: "bold" },
              {
                type: "link",
                attrs: { href: "https://app.excalidraw.com/s/flow-1" },
              },
            ],
          },
          { type: "text", text: ", " },
          {
            type: "text",
            text: "Slides",
            marks: [
              {
                type: "link",
                attrs: { href: "https://slides.example/deck.html" },
              },
            ],
          },
          { type: "text", text: " e " },
          {
            type: "text",
            text: "Resumo PDF",
            marks: [
              {
                type: "link",
                attrs: { href: "/files/summary.pdf" },
              },
            ],
          },
          { type: "text", text: " e " },
          {
            type: "text",
            text: "Dup Diagrama",
            marks: [
              {
                type: "link",
                attrs: { href: "https://app.excalidraw.com/s/flow-1" },
              },
            ],
          },
          { type: "text", text: " e " },
          {
            type: "text",
            text: "Video Link",
            marks: [
              {
                type: "link",
                attrs: { href: "https://youtube.com/watch?v=123" },
              },
            ],
          },
        ],
      },
      {
        type: "image",
        attrs: {
          signed_id: "sig-img-1",
          src: "https://assets.example/originals/arch.png",
        },
      },
      {
        type: "image",
        attrs: {
          src: "https://cdn.example/inline-diagram.png",
          title: "inline-diagram.png",
        },
      },
      {
        type: "image",
        attrs: {
          url: "https://cdn.example/inline-diagram.png",
        },
      },
      {
        type: "image",
        attrs: {
          src: "javascript:alert(1)",
        },
      },
      {
        type: "image",
      },
    ],
  },
};
