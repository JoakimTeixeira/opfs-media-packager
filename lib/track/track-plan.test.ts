import { test } from "vitest";
import assert from "node:assert/strict";
import {
  trackRootFolderName,
  normalizeTopicTitleKey,
  usableTrackTopics,
} from "./track-plan.ts";
import { sanitizeFilenameStem } from "../shared/filename.ts";

test("should normalize duplicate lesson IDs while retaining only valid files", () => {
  const plan = usableTrackTopics([
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
  const plan = usableTrackTopics([
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
      fileTitle: "Topic",
      folderPath: ["Playlist", "video"],
    },
  ]);

  assert.equal(Object.isFrozen(plan[0]), true);
  assert.equal(Object.isFrozen(plan[0]?.folderPath), true);
});

test("should derive content-aligned course root folder prefixes instead of numeric prefixes", () => {
  assert.equal(
    trackRootFolderName("Construindo Aplicações RAG"),
    "(Track) Construindo Aplicações RAG",
  );

  assert.equal(
    trackRootFolderName(
      "Workshop Exemplo #3 - Gravação",
      "https://training.example/c/workshop-exemplo-3/sections/1/lessons/2",
    ),
    "(Workshop) Workshop Exemplo #3 - Gravação",
  );

  assert.equal(
    trackRootFolderName(
      "Gravação Exclusiva",
      "https://training.example/c/workshop-exemplo-2/sections/1/lessons/2",
    ),
    "(Workshop) Gravação Exclusiva",
  );

  assert.equal(
    trackRootFolderName("Bootcamp Engenharia"),
    "(Bootcamp) Bootcamp Engenharia",
  );

  assert.equal(
    trackRootFolderName("Masterclass Arquitetura"),
    "(Masterclass) Masterclass Arquitetura",
  );

  assert.equal(
    trackRootFolderName("Live Tira-Dúvidas"),
    "(Live) Live Tira-Dúvidas",
  );

  assert.equal(
    trackRootFolderName("Palestra Principal"),
    "(Talk) Palestra Principal",
  );

  assert.equal(trackRootFolderName("Trilha Backend"), "(Track) Trilha Backend");

  assert.equal(
    trackRootFolderName("(Custom) Already Prefixed"),
    "(Custom) Already Prefixed",
  );

  assert.equal(trackRootFolderName("   ", "not a url"), "(Track) Track");
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
      normalizeTopicTitleKey(sanitized),
      normalizeTopicTitleKey(raw),
      `Mismatch for ${raw}`,
    );
  }

  assert.equal(normalizeTopicTitleKey("1. Introdução"), "introducao");
  assert.equal(normalizeTopicTitleKey("Introdução"), "introducao");

  assert.equal(
    normalizeTopicTitleKey("9. Estruturas de Evolução de Modelo"),
    "estruturas de evolucao de modelo",
  );
});
