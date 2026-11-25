export function domMaterialsInput(pageUrl: string) {
  return {
    title: "1.3 Fallback",
    pageUrl,
    html: "<p>Veja o diagrama e os slides.</p>",
    images: [
      {
        url: "https://assets.example/rails/active_storage/representations/redirect/img1/var/board.png",
      },
      {
        url: "https://assets.example/rails/active_storage/blobs/redirect/img1/board.png",
      },
      {
        url: "https://cdn.example/photo.jpg",
        filename: "custom-photo.jpg",
      },
      {
        url: "javascript:alert(1)",
      },
    ],
    links: [
      {
        url: "/rails/active_storage/representations/redirect/pdf1/var/guide.pdf",
        text: "Guia",
      },
      {
        url: "/rails/active_storage/representations/redirect/pdf1/var/guide.pdf",
        text: "Dup Guia",
      },
      { url: "https://link.excalidraw.com/l/board-1", text: "" },
      { url: "https://slides.example/?slide=4", text: "" },
      { url: "https://slides.example/?slide=4", text: "Duplicate" },
      { url: "https://cdn.example/%ZZ.png", text: "Malformed encoding" },
      { url: "https://cdn.example/%2F", text: "Slash encoding" },
      { url: "//evil.example/skip", text: "Ignored" },
    ],
  };
}
