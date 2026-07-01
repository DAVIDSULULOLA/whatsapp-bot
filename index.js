const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const readline = require("readline");
const pino = require("pino");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let YOUR_NUMBER = "";
const SUDO_NUMBERS = new Set(["2348132329609@s.whatsapp.net"]);
const LID_MAP = new Set(); // stores @lid versions of sudo numbers

rl.question("Enter your WhatsApp number (e.g. 2348012345678): ", (number) => {
  YOUR_NUMBER = number.trim().replace("+", "") + "@s.whatsapp.net";
  SUDO_NUMBERS.add(YOUR_NUMBER);
  console.log(`✅ Owner set to: ${YOUR_NUMBER}`);
  console.log(`✅ Sudo numbers: ${[...SUDO_NUMBERS].join(", ")}`);
  rl.close();
  startBot();
});

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    shouldIgnoreJid: (jid) => false,
    getMessage: async () => ({ conversation: "" }),
  });

  sock.ev.on("creds.update", saveCreds);

  let busyMode = false;
  let scheduledMessages = [];
  let contactReplies = {};
  let messageStats = {};
  let notes = [];
  let todos = [];

  // ─── HELPERS ───
  function log(msg) {
    fs.appendFileSync(
      "./message_log.txt",
      `[${new Date().toLocaleString()}] ${msg}\n`,
    );
  }

  function extractNumber(jid) {
    if (!jid) return "";
    return jid.split("@")[0].replace(/\D/g, "");
  }

  function normalizeJid(jid) {
    if (!jid) return "";
    return jid.replace(/:[0-9]+/, "").trim();
  }

  function isSudo(jid) {
    if (!jid) return false;
    // Direct match
    if (SUDO_NUMBERS.has(jid)) return true;
    // Check LID_MAP
    if (LID_MAP.has(jid)) return true;
    // Check raw @lid number against sudo numbers
    const jidNum = jid.split("@")[0];
    for (const sudo of SUDO_NUMBERS) {
      const sudoNum = sudo.split("@")[0];
      if (jidNum === sudoNum) return true;
    }
    return false;
  }

  // ─── AUTO LEARN @lid MAPPINGS ───
  // When contacts message us, we map their @lid to their real number
  const contactLidMap = {}; // lid -> real number

  async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
  }

  async function sendMsg(jid, text) {
    await sock.sendMessage(jid, { text });
  }

  // ─── INTENT DETECTION ───
  function detectIntent(text) {
    const t = text.toLowerCase();
    if (t.includes("busy on") || t.includes("turn on busy")) return "busy_on";
    if (
      t.includes("busy off") ||
      t.includes("turn off busy") ||
      t.includes("i am back")
    )
      return "busy_off";
    if (t.includes("create group")) return "create_group";
    if (t.includes("kick everyone") || t.includes("remove everyone"))
      return "kick_all";
    if (t.includes("broadcast")) return "broadcast";
    if (t.includes("schedule")) return "schedule";
    if (t.includes("check number") || t.includes("is on whatsapp"))
      return "info";
    if (t.includes("promote")) return "promote";
    if (t.includes("demote")) return "demote";
    if (t.includes("change group name")) return "group_name";
    if (t.includes("my groups") || t.includes("list groups"))
      return "list_groups";
    if (t.includes("weather")) return "weather";
    if (t.includes("convert")) return "currency";
    if (t.includes("define")) return "dictionary";
    if (t.includes("joke")) return "joke";
    if (t.includes("quote") || t.includes("motivate")) return "quote";
    if (t.includes("stats") || t.includes("report")) return "stats";
    if (t.includes("set reply for")) return "custom_reply";
    if (t.includes("set about") || t.includes("change about"))
      return "set_about";
    if (t.includes("sudo add")) return "sudo_add";
    if (t.includes("sudo remove")) return "sudo_remove";
    if (t.includes("sudo list")) return "sudo_list";
    if (t.includes("timer")) return "timer";
    if (t.includes("calc")) return "calculator";
    if (t.includes("note add")) return "note_add";
    if (t.includes("note list")) return "note_list";
    if (t.includes("note delete")) return "note_delete";
    if (t.includes("music")) return "music";
    if (t.includes("dice") || t.includes("roll")) return "dice";
    if (t.includes("fact")) return "fact";
    if (t.includes("flip") || t.includes("coin")) return "flip";
    if (t.includes("todo add")) return "todo_add";
    if (t.includes("todo list")) return "todo_list";
    if (t.includes("todo done")) return "todo_done";
    if (
      t.match(
        /https?:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com)/i,
      )
    )
      return "download";
    return null;
  }

  // ─── CONNECTION HANDLER ───
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("Scan QR code lol");
    }

    if (connection === "close") {
      console.log("========== CONNECTION CLOSED ==========");
      console.dir(lastDisconnect, { depth: null });

      const statusCode = lastDisconnect?.error?.output?.statusCode;

      console.log("Status code:", statusCode);

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log("Reconnect:", shouldReconnect);

      if (shouldReconnect) {
        setTimeout(() => startBot(), 3000);
      }
    }

    if (connection === "open") {
      console.log("Bot is live lol 🔥");
      setInterval(checkScheduled, 60000);

      setInterval(() => {
        const now = new Date();
        if (now.getHours() === 23 && now.getMinutes() === 0) {
          const top = Object.entries(messageStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          const report = top.map(([n, c]) => `${n}: ${c} messages`).join("\n");
          sendMsg(
            YOUR_NUMBER,
            `📊 Daily Stats:\n${report || "No messages today lol"}`,
          );
          messageStats = {};
        }
      }, 60000);

      setInterval(async () => {
        const now = new Date();
        if (now.getHours() === 7 && now.getMinutes() === 0) {
          const data = await fetchJSON("https://zenquotes.io/api/random");
          sendMsg(
            YOUR_NUMBER,
            `🌅 Morning quote:\n"${data[0].q}" — ${data[0].a}`,
          );
        }
      }, 60000);
    }
  });

  // ─── AUTO VIEW STATUS ───
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.remoteJid === "status@broadcast") {
        try {
          await sock.readMessages([
            {
              remoteJid: "status@broadcast",
              id: msg.key.id,
              participant: msg.key.participant,
            },
          ]);
          console.log(`👁 Viewed status from ${msg.key.participant}`);

          if (msg.message?.imageMessage || msg.message?.videoMessage) {
            if (!fs.existsSync("./statuses")) fs.mkdirSync("./statuses");
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            const ext = msg.message?.imageMessage ? "jpg" : "mp4";
            fs.writeFileSync(`./statuses/status_${Date.now()}.${ext}`, buffer);
            console.log(`💾 Saved status media`);
          }
        } catch (e) {
          console.log(`Status view error: ${e.message}`);
        }
      }
    }
  });

  // ─── ANTI DELETE ───
  sock.ev.on("messages.delete", async (item) => {
    if ("keys" in item) {
      for (const key of item.keys) {
        await sendMsg(YOUR_NUMBER, `🕵️ Message deleted by ${key.remoteJid}`);
      }
    }
  });

  // ─── CONTACTS UPDATE - learn @lid mappings ───
  sock.ev.on("contacts.update", (contacts) => {
    for (const contact of contacts) {
      if (contact.id && contact.lid) {
        contactLidMap[contact.lid] = contact.id;
        // If this contact is a sudo, add their @lid to LID_MAP
        const realJid = contact.id.endsWith("@s.whatsapp.net")
          ? contact.id
          : contact.id + "@s.whatsapp.net";
        if (SUDO_NUMBERS.has(realJid)) {
          LID_MAP.add(contact.lid);
          console.log(`✅ Mapped sudo @lid: ${contact.lid} -> ${realJid}`);
        }
      }
    }
  });

  // ─── MAIN MESSAGE HANDLER ───
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (msg.key.fromMe) continue;

      const rawFrom = msg.key.remoteJid;
      const rawSender = msg.key.participant || msg.key.remoteJid;

      // Resolve @lid to real JID if we have the mapping
      const resolvedFrom = contactLidMap[rawFrom]
        ? contactLidMap[rawFrom] +
          (rawFrom.endsWith("@g.us") ? "" : "@s.whatsapp.net")
        : normalizeJid(rawFrom);

      const resolvedSender = contactLidMap[rawSender]
        ? contactLidMap[rawSender].includes("@")
          ? contactLidMap[rawSender]
          : contactLidMap[rawSender] + "@s.whatsapp.net"
        : normalizeJid(rawSender);

      const from = resolvedFrom;
      const isGroup = rawFrom.endsWith("@g.us");
      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ""
      ).trim();

      if (!text) continue;

      const senderJid = isGroup ? resolvedSender : from;

      console.log(
        `[DEBUG] Raw: ${rawFrom}, Resolved: ${from}, Sender: ${senderJid}, Text: "${text}"`,
      );
      console.log(`[DEBUG] isSudo(${senderJid}): ${isSudo(senderJid)}`);

      log(`${senderJid}: ${text}`);
      if (!isSudo(senderJid)) {
        messageStats[senderJid] = (messageStats[senderJid] || 0) + 1;
      }

      if (!isSudo(senderJid) && busyMode && !isGroup) {
        const hour = new Date().getHours();
        const customReply = contactReplies[senderJid];
        if (customReply) {
          await sendMsg(rawFrom, customReply);
        } else if (hour >= 0 && hour < 7) {
          await sendMsg(rawFrom, "I'm asleep lol, I'll reply in the morning");
        } else {
          await sendMsg(rawFrom, "I'm busy rn lol, I'll reply later");
        }
        await sock.sendMessage(rawFrom, {
          react: { text: "👀", key: msg.key },
        });
        continue;
      }

      const bannedWords = ["scam", "spam", "18+"];
      if (isGroup && bannedWords.some((w) => text.toLowerCase().includes(w))) {
        await sock.sendMessage(rawFrom, { delete: msg.key });
        continue;
      }

      if (!isSudo(senderJid)) {
        console.log(`[DEBUG] Sender is sudo: false`);
        continue;
      }

      console.log(`[DEBUG] Sender is sudo: true ✅`);
      const intent = detectIntent(text);
      if (!intent) continue;

      const reply = async (t) => await sendMsg(rawFrom, t);

      switch (intent) {
        case "busy_on":
          busyMode = true;
          await reply("Busy mode ON lol");
          break;

        case "busy_off":
          busyMode = false;
          await reply("Busy mode OFF lol");
          break;

        case "sudo_add": {
          const num =
            text
              .replace(/sudo add/i, "")
              .trim()
              .replace("+", "") + "@s.whatsapp.net";
          SUDO_NUMBERS.add(num);
          await reply(`${num} can now use the bot lol`);
          break;
        }
        case "sudo_remove": {
          const num =
            text
              .replace(/sudo remove/i, "")
              .trim()
              .replace("+", "") + "@s.whatsapp.net";
          if (num === YOUR_NUMBER) {
            await reply("Can't remove the owner lol");
            break;
          }
          SUDO_NUMBERS.delete(num);
          await reply(`${num} removed lol`);
          break;
        }
        case "sudo_list":
          await reply("Sudo numbers:\n" + [...SUDO_NUMBERS].join("\n"));
          break;

        case "create_group": {
          const name = text.replace(/create group/i, "").trim() || "My Group";
          await sock.groupCreate(name, [YOUR_NUMBER]);
          await reply(`Group "${name}" created lol`);
          break;
        }
        case "list_groups": {
          const groups = await sock.groupFetchAllParticipating();
          const list = Object.values(groups)
            .map((g) => `${g.subject} — ${g.id}`)
            .join("\n");
          await reply(list || "No groups lol");
          break;
        }
        case "kick_all": {
          const groupId = text.split(" ").pop();
          const group = await sock.groupMetadata(groupId);
          const participants = group.participants
            .filter((p) => !p.admin)
            .map((p) => p.id);
          await sock.groupParticipantsUpdate(groupId, participants, "remove");
          await reply("Kicked everyone lol");
          break;
        }
        case "promote": {
          const parts = text.split(" ");
          const num =
            parts[parts.length - 2].replace("+", "") + "@s.whatsapp.net";
          const gid = parts[parts.length - 1];
          await sock.groupParticipantsUpdate(gid, [num], "promote");
          await reply(`${num} promoted lol`);
          break;
        }
        case "demote": {
          const parts = text.split(" ");
          const num =
            parts[parts.length - 2].replace("+", "") + "@s.whatsapp.net";
          const gid = parts[parts.length - 1];
          await sock.groupParticipantsUpdate(gid, [num], "demote");
          await reply(`${num} demoted lol`);
          break;
        }
        case "group_name": {
          const parts = text
            .replace(/change group name/i, "")
            .trim()
            .split(" ");
          const gid = parts[0];
          const newName = parts.slice(1).join(" ");
          await sock.groupUpdateSubject(gid, newName);
          await reply(`Group name changed to "${newName}" lol`);
          break;
        }

        case "broadcast": {
          const bMsg = text.replace(/broadcast/i, "").trim();
          if (!bMsg) {
            await reply("Give me a message to broadcast lol");
            break;
          }
          const chats = await sock.groupFetchAllParticipating();
          let count = 0;
          for (const jid of Object.keys(chats)) {
            if (count >= 20) break;
            await sendMsg(jid, bMsg);
            count++;
          }
          await reply(`Broadcast sent to ${count} chats lol`);
          break;
        }

        case "schedule": {
          const timeMatch = text.match(/\d{2}:\d{2}/);
          const time = timeMatch ? timeMatch[0] : null;
          const message = text
            .replace(/schedule/i, "")
            .replace(time || "", "")
            .trim();
          if (!time) {
            await reply('Give me a time lol e.g. "schedule 20:00 eat food"');
            break;
          }
          scheduledMessages.push({ time, message });
          await reply(`Scheduled "${message}" for ${time} lol`);
          break;
        }

        case "info": {
          const num =
            text
              .replace(/check number|is on whatsapp/i, "")
              .trim()
              .replace("+", "") + "@s.whatsapp.net";
          const result = await sock.onWhatsApp(num);
          await reply(
            result?.length
              ? `That number is on WhatsApp lol`
              : `Not on WhatsApp lol`,
          );
          break;
        }

        case "weather": {
          const city = text.replace(/weather/i, "").trim();
          if (!city) {
            await reply("Tell me the city lol");
            break;
          }
          const data = await fetchJSON(
            `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
          );
          const w = data.current_condition[0];
          await reply(
            `🌤 Weather in ${city}:\nTemp: ${w.temp_C}°C\nFeels like: ${w.FeelsLikeC}°C\nCondition: ${w.weatherDesc[0].value}`,
          );
          break;
        }

        case "currency": {
          const match = text.match(/convert\s+(\d+)\s+(\w+)\s+to\s+(\w+)/i);
          if (!match) {
            await reply('Say it like: "convert 5000 NGN to USD" lol');
            break;
          }
          const [, amount, from_cur, to_cur] = match;
          const data = await fetchJSON(
            `https://open.er-api.com/v6/latest/${from_cur.toUpperCase()}`,
          );
          const rate = data.rates[to_cur.toUpperCase()];
          if (!rate) {
            await reply("Invalid currency lol");
            break;
          }
          await reply(
            `💱 ${amount} ${from_cur.toUpperCase()} = ${(amount * rate).toFixed(2)} ${to_cur.toUpperCase()}`,
          );
          break;
        }

        case "dictionary": {
          const word = text.replace(/define/i, "").trim();
          if (!word) {
            await reply("Tell me the word lol");
            break;
          }
          const data = await fetchJSON(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
          );
          const def = data[0]?.meanings[0]?.definitions[0]?.definition;
          await reply(def ? `📖 ${word}: ${def}` : `Word not found lol`);
          break;
        }

        case "joke": {
          const data = await fetchJSON(
            "https://official-joke-api.appspot.com/random_joke",
          );
          await reply(`😂 ${data.setup}\n\n${data.punchline}`);
          break;
        }

        case "quote": {
          const data = await fetchJSON("https://zenquotes.io/api/random");
          await reply(`💬 "${data[0].q}" — ${data[0].a}`);
          break;
        }

        case "stats": {
          const top = Object.entries(messageStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          const report = top.map(([n, c]) => `${n}: ${c} messages`).join("\n");
          await reply(`📊 Stats:\n${report || "No data yet lol"}`);
          break;
        }

        case "custom_reply": {
          const match = text.match(/set reply for (.+?) as (.+)/i);
          if (!match) {
            await reply(
              'Say it like: "set reply for 2348012345678 as I am busy lol"',
            );
            break;
          }
          const num = match[1].replace("+", "") + "@s.whatsapp.net";
          contactReplies[num] = match[2];
          await reply(`Custom reply set for ${match[1]} lol`);
          break;
        }

        case "set_about": {
          const aboutText = text.replace(/set about|change about/i, "").trim();
          await sock.updateProfileStatus(aboutText);
          await reply(`About updated to: "${aboutText}" lol`);
          break;
        }

        case "timer": {
          const seconds = parseInt(text.replace(/timer/i, "").trim());
          if (isNaN(seconds) || seconds <= 0 || seconds > 3600) {
            await reply("Give me a valid time in seconds (max 3600) lol");
            break;
          }
          await reply(`⏱ Timer set for ${seconds} seconds lol`);
          setTimeout(
            () =>
              sendMsg(rawFrom, `⏰ Timer done! ${seconds} seconds are up lol`),
            seconds * 1000,
          );
          break;
        }

        case "calculator": {
          const expr = text.replace(/calc/i, "").trim();
          try {
            const result = Function(`"use strict"; return (${expr})`)();
            await reply(`🧮 ${expr} = ${result}`);
          } catch {
            await reply("Invalid expression lol");
          }
          break;
        }

        case "note_add": {
          const note = text.replace(/note add/i, "").trim();
          if (!note) {
            await reply("Give me something to save lol");
            break;
          }
          notes.push(note);
          await reply(`📝 Note saved: "${note}" lol`);
          break;
        }
        case "note_list":
          await reply(
            notes.length
              ? "📝 Notes:\n" + notes.map((n, i) => `#${i}: ${n}`).join("\n")
              : "No notes yet lol",
          );
          break;
        case "note_delete": {
          const id = parseInt(text.replace(/note delete/i, "").trim());
          if (isNaN(id) || !notes[id]) {
            await reply("Invalid note ID lol");
            break;
          }
          const deleted = notes.splice(id, 1);
          await reply(`Deleted note: "${deleted[0]}" lol`);
          break;
        }

        case "todo_add": {
          const task = text.replace(/todo add/i, "").trim();
          if (!task) {
            await reply("Give me a task lol");
            break;
          }
          todos.push({ task, done: false });
          await reply(`✅ Todo added: "${task}" lol`);
          break;
        }
        case "todo_list":
          await reply(
            todos.length
              ? "📋 Todos:\n" +
                  todos
                    .map((t, i) => `#${i}: ${t.done ? "✅" : "⬜"} ${t.task}`)
                    .join("\n")
              : "No todos yet lol",
          );
          break;
        case "todo_done": {
          const id = parseInt(text.replace(/todo done/i, "").trim());
          if (isNaN(id) || !todos[id]) {
            await reply("Invalid todo ID lol");
            break;
          }
          todos[id].done = !todos[id].done;
          await reply(
            `Todo #${id} marked as ${todos[id].done ? "done ✅" : "undone ⬜"} lol`,
          );
          break;
        }

        case "music": {
          const song = text.replace(/music/i, "").trim();
          if (!song) {
            await reply("Tell me the song name lol");
            break;
          }
          const data = await fetchJSON(
            `https://itunes.apple.com/search?term=${encodeURIComponent(song)}&media=music&limit=3`,
          );
          if (!data.results.length) {
            await reply("Song not found lol");
            break;
          }
          const results = data.results
            .map(
              (r) =>
                `🎵 ${r.trackName} — ${r.artistName}\n🔗 ${r.trackViewUrl}`,
            )
            .join("\n\n");
          await reply(results);
          break;
        }

        case "dice": {
          const diceMatch = text.match(/d(\d+)/i);
          const sides = diceMatch ? parseInt(diceMatch[1]) : 6;
          const roll = Math.floor(Math.random() * sides) + 1;
          await reply(`🎲 You rolled a d${sides}: ${roll} lol`);
          break;
        }

        case "fact": {
          try {
            const data = await fetchJSON(
              "https://uselessfacts.jsoup.com/api/v1/facts/random?language=en",
            );
            await reply(`🤓 ${data.text}`);
          } catch {
            await reply("Could not fetch a fact rn lol");
          }
          break;
        }

        case "flip": {
          const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
          await reply(`Coin flip: ${result} lol`);
          break;
        }

        case "download": {
          await reply("Downloading... give me a sec lol");
          if (!fs.existsSync("./downloads")) fs.mkdirSync("./downloads");
          const outputPath = path.join(
            __dirname,
            "downloads",
            "%(title)s.%(ext)s",
          );
          exec(
            `yt-dlp -o "${outputPath}" --merge-output-format mp4 "${text}"`,
            async (error) => {
              if (error) {
                await reply("Download failed lol: " + error.message);
                return;
              }
              const files = fs.readdirSync("./downloads");
              if (!files.length) {
                await reply("No file found lol");
                return;
              }
              const filePath = path.join(
                __dirname,
                "downloads",
                files[files.length - 1],
              );
              const buffer = fs.readFileSync(filePath);
              await sock.sendMessage(rawFrom, {
                video: buffer,
                caption: "Here you go lol",
              });
              fs.unlinkSync(filePath);
            },
          );
          break;
        }

        default:
          break;
      }
    }
  });

  function checkScheduled() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    scheduledMessages = scheduledMessages.filter((s) => {
      if (s.time === currentTime) {
        sendMsg(YOUR_NUMBER, s.message);
        return false;
      }
      return true;
    });
  }
}
