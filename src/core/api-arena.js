import {
  ARENA_GAMES,
  ARENA_INGREDIENTS,
  ARENA_PRODUCTS,
} from "./constants.js";
import { runtime } from "./runtime.js";
import { assert, nowIso, todayIso, uuid } from "./utils.js";
import { dropClientToken, success } from "./api-base.js";

const randomHex = (bytes = 32) => {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((item) => item.toString(16).padStart(2, "0")).join("");
};

const periodKeys = (date = new Date()) => {
  const day = todayIso(date);
  const month = day.slice(0, 7);
  const first = new Date(`${day}T12:00:00`);
  const weekday = first.getDay() || 7;
  first.setDate(first.getDate() - weekday + 1);
  return {
    dia: day,
    semana: todayIso(first),
    mes: month,
    geral: "geral",
  };
};

const rankingId = (period, key, uid) => `${period}_${key}_${uid}`;

async function saveArenaResult(profile, gameId, result) {
  const keys = periodKeys();
  for (const period of Object.keys(keys)) {
    const id = rankingId(period, keys[period], profile.UsuarioID);
    const current = await runtime.getById("ArenaRanking", id);
    const gameScores = { ...(current?.ResultadosJogos || {}) };
    const previous = gameScores[gameId] || {};
    gameScores[gameId] = {
      score: Math.max(Number(previous.score || 0), Number(result.score || 0)),
      combo: Math.max(
        Number(previous.combo || 0),
        Number(result.bestCombo || 0),
      ),
      hits: Math.max(Number(previous.hits || 0), Number(result.hits || 0)),
      accuracy: Math.max(
        Number(previous.accuracy || 0),
        Number(result.accuracy || 0),
      ),
      games: Number(previous.games || 0) + 1,
    };
    const best = Object.values(gameScores).reduce(
      (winner, item) => (Number(item.score || 0) > winner.score ? item : winner),
      { score: 0, combo: 0, hits: 0, accuracy: 0 },
    );
    await runtime.upsert("ArenaRanking", {
      RankingID: id,
      PeriodoTipo: period,
      PeriodoChave: keys[period],
      UsuarioID: profile.UsuarioID,
      FuncionarioID: profile.FuncionarioID,
      NomeJogador: profile.Nome,
      LojaID: profile.LojaID || "",
      NomeLoja: profile.NomeLoja || "Sem unidade",
      MelhorPontuacao: Number(best.score || 0),
      MelhorCombo: Number(best.combo || 0),
      MelhorAcertos: Number(best.hits || 0),
      MelhorPrecisao: Number(best.accuracy || 0),
      Partidas: Number(current?.Partidas || 0) + 1,
      AtualizadoEm: nowIso(),
      VersaoJogo: "github-1.0",
      ResultadosJogos: gameScores,
      ResultadosJogosJSON: JSON.stringify(gameScores),
    });
  }
}

const scoreFromPayload = (payload) => {
  const hits = Math.max(
    0,
    Math.min(1000, Number(payload.clientHits || payload.events?.length || 0)),
  );
  const errors = Math.max(
    0,
    Math.min(1000, Number(payload.clientErrors || 0)),
  );
  const score = Math.max(
    0,
    Math.min(
      1000000,
      Number(payload.clientScore || hits * 150 - errors * 40),
    ),
  );
  const total = hits + errors;
  return {
    score: Math.round(score),
    hits,
    errors,
    bestCombo: Math.max(0, Number(payload.clientBestCombo || 0)),
    accuracy: total ? Math.round((hits / total) * 1000) / 10 : 0,
  };
};

async function arenaRanking(filters = {}) {
  const profile = await runtime.requireProfile();
  const period = ["dia", "semana", "mes", "geral"].includes(filters.period)
    ? filters.period
    : "mes";
  const gameId = filters.gameId || "corrida_pedidos";
  const scope = ["loja", "geral", "unidades"].includes(filters.scope)
    ? filters.scope
    : profile.LojaID
      ? "loja"
      : "geral";
  const key = periodKeys()[period];
  const rows = (await runtime.list("ArenaRanking", { profile })).filter(
    (item) =>
      item.PeriodoTipo === period &&
      item.PeriodoChave === key &&
      (scope !== "loja" || item.LojaID === profile.LojaID),
  );
  const playerRows = rows
    .map((item) => {
      const games =
        item.ResultadosJogos ||
        (() => {
          try {
            return JSON.parse(item.ResultadosJogosJSON || "{}");
          } catch {
            return {};
          }
        })();
      if (gameId === "todos") {
        const values = Object.values(games);
        return {
          raw: item,
          score: values.reduce(
            (sum, value) => sum + Number(value.score || 0),
            0,
          ),
          combo: Math.max(0, ...values.map((value) => Number(value.combo || 0))),
          games: values.reduce(
            (sum, value) => sum + Number(value.games || 0),
            0,
          ),
          gamesCount: values.length,
        };
      }
      const score = games[gameId] || {};
      return {
        raw: item,
        score: Number(score.score || 0),
        combo: Number(score.combo || 0),
        games: Number(score.games || 0),
        gamesCount: score.score ? 1 : 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scope === "unidades") {
    const stores = new Map();
    playerRows.forEach((item) => {
      const key = item.raw.LojaID || "sem-unidade";
      const current = stores.get(key) || {
        storeId: key,
        storeName: item.raw.NomeLoja || "Sem unidade",
        scores: [],
        bestScore: 0,
        isMine: key === profile.LojaID,
      };
      current.scores.push(item.score);
      current.bestScore = Math.max(current.bestScore, item.score);
      stores.set(key, current);
    });
    const items = [...stores.values()]
      .map((item) => ({
        ...item,
        players: item.scores.length,
        score: Math.round(
          item.scores.reduce((sum, score) => sum + score, 0) /
            Math.max(1, item.scores.length),
        ),
      }))
      .sort((a, b) => b.score - a.score);
    return {
      period,
      periodKey: key,
      scope,
      gameId,
      gameName: ARENA_GAMES[gameId]?.name || "Todos os jogos",
      items: items.slice(0, Number(filters.limit || 20)),
      me: null,
      myPosition: 0,
      myUnitPosition:
        items.findIndex((item) => item.storeId === profile.LojaID) + 1,
      gamesToday: 0,
      rankedLimit: 20,
    };
  }

  const items = playerRows.map((item) => ({
    playerName: item.raw.NomeJogador,
    storeName: item.raw.NomeLoja,
    score: item.score,
    combo: item.combo,
    games: item.games,
    gamesCount: item.gamesCount,
    isMe: item.raw.UsuarioID === profile.UsuarioID,
  }));
  const meIndex = items.findIndex((item) => item.isMe);
  const todayRecord = await runtime.getById(
    "ArenaRanking",
    rankingId("dia", periodKeys().dia, profile.UsuarioID),
  );
  return {
    period,
    periodKey: key,
    scope,
    gameId,
    gameName: ARENA_GAMES[gameId]?.name || "Todos os jogos",
    items: items.slice(0, Number(filters.limit || 20)),
    me: meIndex >= 0 ? items[meIndex] : null,
    myPosition: meIndex + 1,
    myUnitPosition: 0,
    gamesToday: Number(todayRecord?.Partidas || 0),
    rankedLimit: 20,
  };
}

const HOUSE_OPTIONS = {
  size: [
    { id: "normal", label: "Normal", emoji: "🥤" },
    { id: "grande", label: "Grande", emoji: "🥤+" },
  ],
  side: [
    { id: "batata", label: "Batata", emoji: "🍟" },
    { id: "onion", label: "Onion rings", emoji: "🧅" },
    { id: "salada", label: "Salada", emoji: "🥗" },
  ],
  drink: [
    { id: "cola", label: "Cola", emoji: "🥤" },
    { id: "zero", label: "Cola zero", emoji: "Ⓩ" },
    { id: "suco", label: "Suco", emoji: "🧃" },
    { id: "agua", label: "Água", emoji: "💧" },
  ],
  restriction: [
    { id: "completo", label: "Completo", emoji: "✅" },
    { id: "sem_cebola", label: "Sem cebola", emoji: "🚫🧅" },
    { id: "sem_molho", label: "Sem molho", emoji: "🚫🌶️" },
    { id: "sem_queijo", label: "Sem queijo", emoji: "🚫🧀" },
  ],
};

const HOUSE_EMOTES = [
  { id: "foguete", emoji: "🚀", label: "Vamos!" },
  { id: "perfeito", emoji: "✨", label: "Perfeito!" },
  { id: "atencao", emoji: "👀", label: "Atenção" },
  { id: "boa", emoji: "🙌", label: "Boa!" },
];

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCode = () =>
  Array.from({ length: 6 }, () =>
    codeAlphabet.charAt(Math.floor(Math.random() * codeAlphabet.length)),
  ).join("");

const roomPlayer = (profile) => ({
  usuarioId: profile.UsuarioID,
  funcionarioId: profile.FuncionarioID,
  nome: profile.Nome,
  lojaId: profile.LojaID || "",
  nomeLoja: profile.NomeLoja || "Unidade",
  lastSeen: Date.now(),
});

const roomRole = (room, slot) =>
  Number(room.phase || 0) === 0
    ? slot === "p1"
      ? "front"
      : "kitchen"
    : slot === "p1"
      ? "kitchen"
      : "front";

const orderOption = (group, index) =>
  HOUSE_OPTIONS[group][index % HOUSE_OPTIONS[group].length];

const generateOrder = (index) => {
  const groups = ["size", "side", "drink", "restriction"];
  const details = Object.fromEntries(
    groups.map((group, position) => [
      group,
      orderOption(group, index + position).id,
    ]),
  );
  const signalChoices = groups.map((group) => {
    const option = HOUSE_OPTIONS[group].find(
      (item) => item.id === details[group],
    );
    return {
      id: `${group}:${option.id}`,
      group,
      value: option.id,
      label: option.label,
      emoji: option.emoji,
    };
  });
  return {
    id: `order-${index}-${Date.now().toString(36)}`,
    index,
    product: ARENA_PRODUCTS[index % ARENA_PRODUCTS.length],
    vip: index > 0 && index % 4 === 0,
    urgent: index > 0 && index % 3 === 1,
    details,
    signalChoices,
  };
};

const addRoomEvent = (room, type, from, data = {}) => {
  room.events = room.events || [];
  room.events.push({
    id: `evt-${uuid()}`,
    type,
    from,
    at: Date.now(),
    data,
  });
  room.events = room.events.slice(-16);
};

const advanceRoom = (room) => {
  const now = Date.now();
  if (room.status === "countdown" && now >= room.startedAt) {
    room.status = "playing";
    addRoomEvent(room, "match_started", "duo", {
      text: "O portal está aberto!",
    });
  }
  if (room.status === "playing" && now >= room.endsAt) {
    room.status = "finished";
    const attempts = Number(room.hits || 0) + Number(room.errors || 0);
    const accuracy = attempts
      ? Math.round((Number(room.hits || 0) / attempts) * 1000) / 10
      : 0;
    room.result = {
      cancelled: false,
      score: Number(room.score || 0),
      hits: Number(room.hits || 0),
      errors: Number(room.errors || 0),
      accuracy,
      bestCombo: Number(room.bestCombo || 0),
      satisfaction: Number(room.satisfaction || 0),
      grade: accuracy >= 90 ? "A" : accuracy >= 70 ? "B" : "C",
      title:
        Number(room.score || 0) >= 4000
          ? "Sintonia impressionante!"
          : "Operação concluída!",
      medals: {
        p1: { icon: "🤝", title: "Parceiro House", text: "Dupla conectada." },
        p2: { icon: "💫", title: "Parceiro House", text: "Dupla conectada." },
      },
    };
    addRoomEvent(room, "match_finished", "duo", {
      text: "Operação concluída!",
    });
  } else if (
    room.status === "playing" &&
    room.phase === 0 &&
    now >= room.swapAt
  ) {
    room.phase = 1;
    room.orderIndex += 1;
    room.order = generateOrder(room.orderIndex);
    room.tray = null;
    room.signals = [];
    addRoomEvent(room, "role_swap", "duo", {
      text: "Troca de turno!",
    });
  }
  room.updatedAt = now;
  room.revision += 1;
  return room;
};

const participantSlot = (room, profile) => {
  if (room.players?.p1?.usuarioId === profile.UsuarioID) return "p1";
  if (room.players?.p2?.usuarioId === profile.UsuarioID) return "p2";
  throw new Error("Você não faz parte desta sala.");
};

const publicRoom = (room, profile) => {
  const slot = participantSlot(room, profile);
  const partnerSlot = slot === "p1" ? "p2" : "p1";
  const player = room.players[slot];
  const partner = room.players[partnerSlot];
  const role = roomRole(room, slot);
  const order =
    room.order && ["countdown", "playing"].includes(room.status)
      ? {
          id: room.order.id,
          index: room.orderIndex,
          product: room.order.product,
          vip: room.order.vip,
          urgent: room.order.urgent,
          signalChoices: role === "front" ? room.order.signalChoices : [],
          details: role === "front" ? room.order.details : null,
        }
      : null;
  const publicPlayer = (value, valueSlot) =>
    value
      ? {
          slot: valueSlot,
          name: value.nome,
          initials: String(value.nome || "")
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] || "")
            .join("")
            .toUpperCase(),
          storeName: value.nomeLoja,
          role: roomRole(room, valueSlot),
          online: Date.now() - Number(value.lastSeen || 0) <= 30000,
        }
      : null;
  return {
    roomId: room.id,
    code: room.code,
    version: "1.0.0-firebase",
    revision: room.revision,
    serverNow: Date.now(),
    status: room.status,
    phase: room.phase,
    startedAt: room.startedAt,
    swapAt: room.swapAt,
    endsAt: room.endsAt,
    player: publicPlayer(player, slot),
    partner: publicPlayer(partner, partnerSlot),
    ready: {
      me: room.ready[slot] === true,
      partner: room.ready[partnerSlot] === true,
    },
    score: room.score,
    combo: room.combo,
    bestCombo: room.bestCombo,
    hits: room.hits,
    errors: room.errors,
    satisfaction: room.satisfaction,
    linkPower: room.linkPower,
    harmonyUntil: room.harmonyUntil,
    order,
    orderStartedAt: room.orderStartedAt,
    signals: room.signals || [],
    tray: room.tray
      ? {
          selection: room.tray.selection,
          sentAt: room.tray.sentAt,
          byPartner: room.tray.by === partnerSlot,
        }
      : null,
    incident: null,
    options: HOUSE_OPTIONS,
    emotes: HOUSE_EMOTES,
    events: room.events || [],
    result: room.result || null,
    rematch: {
      me: room.rematch?.[slot] === true,
      partner: room.rematch?.[partnerSlot] === true,
    },
    ranked: true,
  };
};

async function loadRoom(roomId, profile) {
  const room = await runtime.getPath(`arenaLink/rooms/${roomId}`);
  assert(room?.id, "Esta sala não existe mais.");
  participantSlot(room, profile);
  return advanceRoom(room);
}

export function createArenaHandlers() {
  return {
    async startHouseArenaGame(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      const game = ARENA_GAMES[payload.gameId || "corrida_pedidos"];
      assert(game && payload.gameId !== "house_link", "Escolha um jogo válido.");
      const token = randomHex(32);
      const seed = Math.floor(Math.random() * 2147483000) + 1;
      const daily = await runtime.getById(
        "ArenaRanking",
        rankingId("dia", periodKeys().dia, profile.UsuarioID),
      );
      await runtime.setPath(`arenaRuns/${profile.UsuarioID}/${token}`, {
        token,
        gameId: payload.gameId,
        seed,
        startedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return success({
        token,
        seed,
        durationMs: game.durationMs,
        gameId: payload.gameId,
        gameName: game.name,
        gameVersion: "github-1.0",
        ranked: false,
        playedToday: Number(daily?.Partidas || 0),
        rankedLimit: 0,
        products: ARENA_PRODUCTS,
        ingredients: ARENA_INGREDIENTS,
        player: { name: profile.Nome, storeName: profile.NomeLoja },
      });
    },

    async finishHouseArenaGame(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      assert(/^[a-f0-9]{64}$/i.test(payload.token || ""), "Partida inválida.");
      const run = await runtime.getPath(
        `arenaRuns/${profile.UsuarioID}/${payload.token}`,
      );
      assert(run && run.expiresAt > Date.now(), "A partida expirou.");
      const result = scoreFromPayload(payload);
      const daily = await runtime.getById(
        "ArenaRanking",
        rankingId("dia", periodKeys().dia, profile.UsuarioID),
      );
      // Em uma aplicação estática, a pontuação calculada no navegador não
      // pode ser validada com segurança. A partida continua recreativa, sem
      // gravar resultados competitivos manipuláveis no ranking global.
      const ranked = false;
      await runtime.removePath(
        `arenaRuns/${profile.UsuarioID}/${payload.token}`,
      );
      const overview = await arenaRanking({
        period: "mes",
        scope: profile.LojaID ? "loja" : "geral",
        gameId: run.gameId,
      });
      return success({
        gameId: run.gameId,
        gameName: ARENA_GAMES[run.gameId].name,
        ...result,
        ranked,
        personalBest: Number(overview.me?.score || result.score),
        myPosition: overview.myPosition || 0,
        rankedGamesToday: Number(daily?.Partidas || 0),
        rankedLimit: 0,
      });
    },

    async getHouseArenaRankings(args) {
      return success(await arenaRanking(args[0] || {}));
    },

    async createHouseLinkRoom() {
      const profile = await runtime.requireProfile();
      const id = randomHex(16);
      const code = roomCode();
      const now = Date.now();
      const room = {
        id,
        code,
        revision: 1,
        status: "waiting",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 12 * 60 * 1000,
        players: { p1: roomPlayer(profile), p2: null },
        ready: { p1: false, p2: false },
        startedAt: 0,
        swapAt: 0,
        endsAt: 0,
        phase: 0,
        score: 0,
        combo: 0,
        bestCombo: 0,
        hits: 0,
        errors: 0,
        satisfaction: 100,
        linkPower: 0,
        harmonyUntil: 0,
        orderIndex: 0,
        orderStartedAt: 0,
        order: null,
        signals: [],
        tray: null,
        events: [],
        rematch: { p1: false, p2: false },
        result: null,
      };
      await runtime.setPath(`arenaLink/rooms/${id}`, room);
      await runtime.setPath(`arenaLink/codes/${code}`, {
        roomId: id,
        expiresAt: room.expiresAt,
      });
      return success(publicRoom(room, profile), "Sala criada.");
    },

    async joinHouseLinkRoom(args) {
      const profile = await runtime.requireProfile();
      const code = String(args[0]?.code || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
      assert(code.length === 6, "Digite o código de seis caracteres.");
      const mapping = await runtime.getPath(`arenaLink/codes/${code}`);
      assert(mapping?.roomId, "Sala não encontrada ou código expirado.");
      const room = await runtime.getPath(`arenaLink/rooms/${mapping.roomId}`);
      assert(room && room.expiresAt > Date.now(), "Sala expirada.");
      assert(!room.players.p2, "Esta dupla já está completa.");
      assert(
        room.players.p1.usuarioId !== profile.UsuarioID,
        "Abra o código no celular de outro funcionário.",
      );
      room.players.p2 = roomPlayer(profile);
      addRoomEvent(room, "partner_joined", "p2", {
        text: `${profile.Nome} entrou na conexão.`,
      });
      room.revision += 1;
      room.updatedAt = Date.now();
      await runtime.setPath(`arenaLink/rooms/${room.id}`, room);
      return success(publicRoom(room, profile), "Dupla conectada.");
    },

    async getHouseLinkState(args) {
      const profile = await runtime.requireProfile();
      const room = await loadRoom(args[0]?.roomId, profile);
      await runtime.setPath(`arenaLink/rooms/${room.id}`, room);
      return success(publicRoom(room, profile));
    },

    async heartbeatHouseLink(args) {
      const profile = await runtime.requireProfile();
      const room = await loadRoom(args[0]?.roomId, profile);
      const slot = participantSlot(room, profile);
      room.players[slot].lastSeen = Date.now();
      await runtime.setPath(`arenaLink/rooms/${room.id}`, room);
      return success(publicRoom(room, profile));
    },

    async sendHouseLinkAction(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      const room = await loadRoom(payload.roomId, profile);
      const slot = participantSlot(room, profile);
      const partnerSlot = slot === "p1" ? "p2" : "p1";
      const type = String(payload.type || "");
      const data = payload.data || {};
      if (type === "ready") {
        room.ready[slot] = data.ready !== false;
        if (room.ready.p1 && room.ready.p2 && room.players.p2) {
          const now = Date.now();
          room.status = "countdown";
          room.startedAt = now + 3000;
          room.swapAt = room.startedAt + 40000;
          room.endsAt = room.swapAt + 40000;
          room.order = generateOrder(0);
          room.orderStartedAt = room.startedAt;
          addRoomEvent(room, "countdown", "duo", {
            text: "Conexão estabelecida. Preparem-se!",
          });
        }
      } else if (type === "signal") {
        const option = room.order?.signalChoices?.find(
          (item) => item.id === data.signal,
        );
        if (option && !room.signals.some((item) => item.id === option.id)) {
          room.signals.push({ ...option, sentAt: Date.now() });
          room.score += 20;
          room.linkPower = Math.min(100, room.linkPower + 5);
          addRoomEvent(room, "signal", slot, { signal: option, useful: true });
        }
      } else if (type === "submit_tray") {
        room.tray = {
          by: slot,
          selection: data.selection || {},
          sentAt: Date.now(),
        };
        addRoomEvent(room, "portal_transfer", slot, {
          text: "Bandeja atravessou o portal.",
        });
      } else if (type === "return_tray") {
        room.tray = null;
        addRoomEvent(room, "tray_returned", slot, {
          text: "Bandeja devolvida.",
        });
      } else if (type === "deliver") {
        assert(room.tray && room.order, "A bandeja ainda não chegou.");
        const correct = Object.entries(room.order.details).every(
          ([key, value]) => room.tray.selection?.[key] === value,
        );
        if (correct) {
          room.hits += 1;
          room.combo += 1;
          room.bestCombo = Math.max(room.bestCombo, room.combo);
          room.score += 750 + room.combo * 30;
          room.satisfaction = Math.min(100, room.satisfaction + 4);
          addRoomEvent(room, "delivery_success", slot, {
            earned: 750,
            combo: room.combo,
            text: "Pedido entregue com sucesso!",
          });
        } else {
          room.errors += 1;
          room.combo = 0;
          room.satisfaction = Math.max(0, room.satisfaction - 15);
          addRoomEvent(room, "delivery_error", slot, {
            text: "A bandeja não corresponde à comanda.",
          });
        }
        room.orderIndex += 1;
        room.order = generateOrder(room.orderIndex);
        room.orderStartedAt = Date.now();
        room.tray = null;
        room.signals = [];
      } else if (type === "emote") {
        const emote = HOUSE_EMOTES.find((item) => item.id === data.emote);
        if (emote) addRoomEvent(room, "emote", slot, { emote });
      } else if (type === "rematch") {
        room.rematch[slot] = data.ready !== false;
        if (room.rematch.p1 && room.rematch.p2) {
          room.ready = { p1: false, p2: false };
          room.rematch = { p1: false, p2: false };
          room.status = "waiting";
          room.result = null;
        }
      } else if (type === "pulse") {
        room.score += 150;
        room.linkPower = Math.min(100, room.linkPower + 20);
        addRoomEvent(room, "pulse_complete", "duo", {
          text: "Pulso de sincronia!",
        });
      }
      room.players[slot].lastSeen = Date.now();
      if (room.players[partnerSlot]) room.expiresAt = Date.now() + 12 * 60 * 1000;
      room.updatedAt = Date.now();
      room.revision += 1;
      await runtime.setPath(`arenaLink/rooms/${room.id}`, room);
      return success(publicRoom(room, profile));
    },

    async leaveHouseLinkRoom(args) {
      const profile = await runtime.requireProfile();
      const payload = args[0] || {};
      const room = await loadRoom(payload.roomId, profile);
      const slot = participantSlot(room, profile);
      if (room.status === "waiting" && slot === "p2") {
        room.players.p2 = null;
        room.ready.p2 = false;
      } else {
        room.status = "cancelled";
        room.cancelledBy = slot;
        room.result = {
          cancelled: true,
          score: room.score,
          title: "Conexão interrompida",
        };
      }
      room.revision += 1;
      await runtime.setPath(`arenaLink/rooms/${room.id}`, room);
      return success(publicRoom(room, profile));
    },
  };
}
