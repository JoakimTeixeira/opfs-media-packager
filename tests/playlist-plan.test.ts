import test from "node:test";
import assert from "node:assert/strict";
import {
  playlistRootFolderName,
  normalizeItemTitleKey,
  usablePlaylistItems,
} from "../lib/playlist-plan.ts";
import { sanitizeFilenameStem } from "../lib/filename.ts";
import {
  numericQualityOptions,
  mediaReferrerPolicy,
  masterUrlForDetectedPlaylist,
} from "../lib/player-adapters.ts";

test("should normalize duplicate lesson IDs while retaining only valid files", () => {
  const plan = usablePlaylistItems([
    {
      id: "1",
      url: "https://example/1",
      fileTitle: "One",
      folderPath: ["Playlist"],
      navigationIndex: 0,
    },
    {
      id: "1",
      url: "https://example/duplicate",
      fileTitle: "Duplicate",
      folderPath: ["Playlist"],
    },
    {
      id: "",
      url: "https://example/missing",
      fileTitle: "Missing",
      folderPath: [],
    },
  ]);

  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.fileTitle, "One");
  assert.equal(plan[0]?.navigationIndex, 0);
});

test("should normalize default titles and freeze folder paths without accepting duplicate or incomplete lessons", () => {
  const plan = usablePlaylistItems([
    {
      id: "a",
      url: "https://example/a",
      folderPath: ["Playlist", ""],
      fileTitle: "",
    },
    { id: "b", url: "", folderPath: ["Playlist"], fileTitle: "Missing URL" },
    {
      id: "a",
      url: "https://example/a-again",
      folderPath: ["Playlist"],
      fileTitle: "Duplicate",
    },
  ]);

  assert.deepEqual(plan, [
    {
      id: "a",
      url: "https://example/a",
      fileTitle: "Item",
      folderPath: ["Playlist", "video"],
    },
  ]);

  assert.equal(Object.isFrozen(plan[0]), true);
  assert.equal(Object.isFrozen(plan[0]?.folderPath), true);
});

test("should map a numeric quality playlist to its master manifest", () => {
  const quality = "https://media.example.net/video-id/1080p/video.m3u8";

  assert.equal(
    masterUrlForDetectedPlaylist(quality),
    "https://media.example.net/video-id/playlist.m3u8",
  );

  assert.equal(
    masterUrlForDetectedPlaylist(
      "https://media.example.net/video-id/master.m3u8",
    ),
    "https://media.example.net/video-id/playlist.m3u8",
  );

  assert.equal(
    masterUrlForDetectedPlaylist("https://cdn.example/stream.m3u8"),
    null,
  );

  assert.equal(masterUrlForDetectedPlaylist("not a URL"), null);
});

test("should preserve quality query strings while rejecting malformed paths", () => {
  const url =
    "https://media.example.net/course/1080p/video.m3u8?token=abc#part";

  assert.equal(
    masterUrlForDetectedPlaylist(url),
    "https://media.example.net/course/playlist.m3u8?token=abc#part",
  );

  assert.equal(
    masterUrlForDetectedPlaylist(
      "https://media.example.net/course/1080p/video.m3u8x",
    ),
    null,
  );

  assert.equal(
    masterUrlForDetectedPlaylist("https://media.example.net/course/1080p/"),
    null,
  );
});

test("should list numeric quality options from master and playlist URLs", () => {
  const options = numericQualityOptions(
    "https://media.example.net/course-id/master.m3u8?token=abc",
  );

  assert.deepEqual(
    options.map((option) => option.label),
    ["1080p", "720p", "480p", "360p", "240p"],
  );

  assert.equal(
    options[1]?.url,
    "https://media.example.net/course-id/720p/video.m3u8?token=abc",
  );

  assert.deepEqual(
    numericQualityOptions(
      "https://media.example.net/course-id/playlist.m3u8?token=abc",
    ).map((option) => option.label),
    ["1080p", "720p", "480p", "360p", "240p"],
  );

  assert.deepEqual(numericQualityOptions("https://cdn.example/video.ts"), []);

  assert.deepEqual(
    numericQualityOptions(
      "https://media.example.net/course/not-a-playlist.m3u8",
    ),
    [],
  );

  assert.deepEqual(numericQualityOptions("not a URL"), []);
});

test("should use the complete lesson referer for a structured course stream", () => {
  const lesson = "https://training.example/courses/course/lessons/1?chapter=1";

  assert.equal(
    mediaReferrerPolicy(
      "https://media.example.net/video/720p/video.m3u8",
      lesson,
    ),
    "unsafe-url",
  );

  assert.equal(
    mediaReferrerPolicy("https://cdn.example/video.m3u8", lesson),
    "strict-origin-when-cross-origin",
  );

  assert.equal(
    mediaReferrerPolicy("not a URL", lesson),
    "strict-origin-when-cross-origin",
  );

  assert.equal(
    mediaReferrerPolicy(
      "https://media.example.net/video/720p/video.m3u8",
      "not a URL",
    ),
    "strict-origin-when-cross-origin",
  );
});

test("should derive content-aligned course root folder prefixes instead of numeric prefixes", () => {
  assert.equal(
    playlistRootFolderName("Construindo Aplicações RAG"),
    "(Playlist) Construindo Aplicações RAG",
  );

  assert.equal(
    playlistRootFolderName(
      "Workshop Exemplo #3 - Gravação",
      "https://training.example/c/workshop-exemplo-3/sections/1/lessons/2",
    ),
    "(Workshop) Workshop Exemplo #3 - Gravação",
  );

  assert.equal(
    playlistRootFolderName(
      "Gravação Exclusiva",
      "https://training.example/c/workshop-exemplo-2/sections/1/lessons/2",
    ),
    "(Workshop) Gravação Exclusiva",
  );

  assert.equal(
    playlistRootFolderName("Bootcamp Engenharia"),
    "(Bootcamp) Bootcamp Engenharia",
  );

  assert.equal(
    playlistRootFolderName("Masterclass Arquitetura"),
    "(Masterclass) Masterclass Arquitetura",
  );

  assert.equal(
    playlistRootFolderName("Live Tira-Dúvidas"),
    "(Live) Live Tira-Dúvidas",
  );

  assert.equal(
    playlistRootFolderName("Palestra Principal"),
    "(Talk) Palestra Principal",
  );

  assert.equal(
    playlistRootFolderName("Trilha Backend"),
    "(Track) Trilha Backend",
  );

  assert.equal(
    playlistRootFolderName("(Custom) Already Prefixed"),
    "(Custom) Already Prefixed",
  );

  assert.equal(
    playlistRootFolderName("   ", "not a url"),
    "(Playlist) Playlist",
  );
});

test("should normalize raw and filename-sanitized lesson and section titles identically", () => {
  const rawTitles = [
    "Notas, recursos, exemplos",
    "Mapeamento Origem -> Destino",
    "Um novo tema: Relatórios e introdução ao Catálogo",
    "Tratamento de Erros – Padronizando e Protegendo o Fluxo",
    "Validação Automatizada — Protegendo o Projeto com Regras",
    "Processamento Assíncrono — Filas e Separação de Camadas",
  ];

  for (const [index, raw] of rawTitles.entries()) {
    const sanitized = sanitizeFilenameStem(`1.${index + 1} ${raw}`);

    assert.equal(
      normalizeItemTitleKey(sanitized),
      normalizeItemTitleKey(raw),
      `Mismatch for ${raw}`,
    );
  }

  assert.equal(normalizeItemTitleKey("1. Introdução"), "introducao");
  assert.equal(normalizeItemTitleKey("Introdução"), "introducao");

  assert.equal(
    normalizeItemTitleKey("9. Estruturas de Evolução de Modelo"),
    "estruturas de evolucao de modelo",
  );
});
