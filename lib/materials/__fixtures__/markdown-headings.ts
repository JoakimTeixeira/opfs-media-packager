export const alreadyTitled = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "2.4   Feature Design" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Content" }] },
  ],
};

export const subheadingFirst = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "2.4 Feature Design" }],
    },
  ],
};
