export const edgeRichTextInput = {
  inline_attachments: [
    {
      signedId: "camel-1",
      url: "https://assets.example/pic.jpg",
    },
    {
      url: "https://assets.example/download-pdf/",
      contentType: "application/pdf",
    },
  ],
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "One",
            marks: [
              {
                type: "link",
                attrs: { url: "https://app.excalidraw.com/s/1" },
              },
            ],
          },
          {
            type: "text",
            text: "Two",
            marks: [
              {
                type: "link",
                attrs: { href: "https://slides.example/?slide=2" },
              },
            ],
          },
          {
            type: "text",
            text: "Bad",
            marks: [{ type: "link", attrs: { href: "javascript:bad" } }],
          },
        ],
      },
      {
        type: "image",
        attrs: {
          signedId: "camel-1",
          src: "https://assets.example/pic.jpg",
        },
      },
      {
        type: "image",
        attrs: {
          src: "https://assets.example/rails/active_storage/representations/redirect/body1/var/shot.png",
          filename: "folder/shot.png",
        },
      },
    ],
  },
};
