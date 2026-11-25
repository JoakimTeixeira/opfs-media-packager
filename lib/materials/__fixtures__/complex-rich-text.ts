export const complexRichText = {
  sgids_to_object_map: {
    "sgid-post-1": {
      name: "Post Video 1",
      url: "https://training.example/c/comunidade/post-1",
    },
    "sgid-embed-post": {
      type: "embed",
      title: "Preview Session",
      url: "https://training.example/c/events/preview-session",
    },
    "sgid-embed-diag": {
      type: "embed",
      title: "Embed Diagram",
      url: "https://app.excalidraw.com/l/room/embed-1",
    },
    "sgid-diag": {
      name: "Diagrama Excalidraw",
      url: "https://app.excalidraw.com/l/room/1",
    },
    "sgid-related": {
      name: "Relacionado",
      url: "https://training.example/c/comunidade/relacionado",
    },
  },
  entities: [
    {
      sgid: "sgid-post-1",
      name: "Duplicate Ignored",
      url: "https://training.example/c/comunidade/other",
    },
    {
      sgid: "sgid-post-2",
      title: "Post Video 2",
      url: "/c/comunidade/post-2",
    },
    {
      sgid: "sgid-invalid",
      name: "Invalid",
      url: "javascript:bad",
    },
  ],
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "entity", attrs: { sgid: "sgid-post-1" } },
          { type: "text", text: " " },
          { type: "entity", attrs: { sgid: "sgid-diag" } },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "entity", attrs: { sgid: "sgid-post-2" } },
          {
            type: "text",
            text: " yt ",
            marks: [
              {
                type: "link",
                attrs: { href: "https://www.youtube.com/watch?v=abc12345" },
              },
            ],
          },
        ],
      },
      {
        type: "embed",
        attrs: { sgid: "sgid-embed-post" },
      },
      {
        type: "embed",
        attrs: { sgid: "sgid-embed-diag" },
      },
      {
        type: "embed",
        attrs: {
          src: "https://slides.example/deck?slide=1",
          title: "Slides Deck",
        },
      },
      {
        type: "embed",
        attrs: {},
      },
      {
        type: "cta",
        attrs: {
          label: "Post 3 CTA",
          url: "https://training.example/c/comunidade/post-3",
        },
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          { type: "text", text: "Conteúdos relacionados na plataforma" },
        ],
      },
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Subseção" }],
      },
      {
        type: "paragraph",
        content: [{ type: "entity", attrs: { sgid: "sgid-related" } }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Outro bloco" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Conteúdos relacionados",
            marks: [{ type: "bold" }],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Skip list link",
                    marks: [
                      {
                        type: "link",
                        attrs: {
                          href: "https://training.example/c/comunidade/skip-list",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Texto normal retomado." }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Final post",
            marks: [
              {
                type: "link",
                attrs: {
                  href: "https://training.example/c/comunidade/post-final",
                },
              },
            ],
          },
        ],
      },
    ],
  },
};
