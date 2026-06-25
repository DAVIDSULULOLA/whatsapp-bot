const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const readline = require("readline");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
});

// ─── CONFIG ───
// Owner number will be collected at runtime if not provided via env var
let YOUR_NUMBER = process.env.YOUR_NUMBER || "";
let SUDO_NUMBERS = new Set(
  (process.env.SUDO_NUMBERS || "").split(",").filter(Boolean),
);
// Add any hardcoded fallbacks here if you want, otherwise keep SUDO empty
const MAX_BROADCAST_RECIPIENTS = 20;
const BROADCAST_RATE_LIMIT_MS = 10 * 60 * 1000; // one broadcast every 10 minutes
const COMMAND_RATE_LIMIT_MS = 10 * 1000; // one command every 10 seconds per sudo

const COMMAND_LIST = [
  "busy on / busy off",
  "create group <name>",
  "delete group <groupId>",
  "kick everyone <groupId>",
  "broadcast <message>",
  "schedule <HH:MM> <message>",
  "check number <phone>",
  "promote <number> <groupId>",
  "demote <number> <groupId>",
  "change group name <groupId> <new name>",
  "my groups / list groups",
  "weather <city>",
  "convert <amount> <from> to <to>",
  "define <word>",
  "joke",
  "quote",
  "stats",
  "set reply for <number> as <message>",
  "set about <text>",
  "sudo add <number>",
  "sudo remove <number>",
  "sudo list",
  "<video url> (download)",
  "timer <seconds> (countdown timer)",
  "calc <expression> (calculator)",
  "note add <text> / note list / note delete <id>",
  "music <song name> (search songs)",
  "dice / roll <d6/d20/d100> (dice roller)",
  "fact (random fact)",
  "flip (coin flip)",
  "todo add <task> / todo list / todo done <id>",
];

let busyMode = false;
let scheduledMessages = [];
let contactReplies = {};
let messageStats = {};
let lastCommandAt = new Map();
let lastBroadcastAt = 0;
let notes = [];
let todos = [];
let userTimers = new Map();

// ─── HELPERS ───
function log(msg) {
  fs.appendFileSync(
    "./message_log.txt",
    `[${new Date().toLocaleString()}] ${msg}\n`,
  );
}
function normalizeJid(jid) {
  if (!jid) return "";
  const val = jid.toString().toLowerCase();
  if (val.includes("@")) {
    return val.split("@")[0].replace(/\D/g, "");
  }
  return val.replace(/\D/g, "").replace(/^0+/, "");
}
function isSudo(number) {
  if (!number) return false;
  const normalized = normalizeJid(number);
  return [...SUDO_NUMBERS].some((n) => normalizeJid(n) === normalized);
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

// ─── INTENT DETECTION ───
function detectIntent(text) {
  const t = text.toLowerCase();
  if (
    t.includes("busy on") ||
    t.includes("turn on busy") ||
    t.includes("set busy")
  )
    return "busy_on";
  if (
    t.includes("busy off") ||
    t.includes("turn off busy") ||
    t.includes("i am back")
  )
    return "busy_off";
  if (t.includes("create group")) return "create_group";
  if (t.includes("delete group")) return "delete_group";
  if (t.includes("kick everyone") || t.includes("remove everyone"))
    return "kick_all";
  if (t.includes("broadcast")) return "broadcast";
  if (t.includes("schedule")) return "schedule";
  if (t.includes("check number") || t.includes("is on whatsapp")) return "info";
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
  if (t.includes("set about") || t.includes("change about")) return "set_about";
  if (t.includes("sudo add")) return "sudo_add";
  if (t.includes("sudo remove")) return "sudo_remove";
  if (t.includes("sudo list")) return "sudo_list";
  if (
    t.match(
      /https?:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com)/i,
    )
  )
    return "download";
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
  return null;
}

// ─── QR & READY ───
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Scan QR lol");
});
client.on("ready", async () => {
  console.log("Bot is live lol");
  setInterval(checkScheduled, 60000);

  const commandMessage = `🤖 Bot is live! Available commands:\n\n${COMMAND_LIST.join("\n")}`;
  try {
    await client.sendMessage(YOUR_NUMBER, commandMessage);
  } catch (error) {
    console.error(
      "[DEBUG] Failed to send startup commands to owner:",
      error.message || error,
    );
  }

  for (const sudo of SUDO_NUMBERS) {
    if (sudo === YOUR_NUMBER) continue;
    try {
      await client.sendMessage(sudo, commandMessage);
    } catch (error) {
      console.error(
        `[DEBUG] Failed to send startup commands to sudo ${sudo}:`,
        error.message || error,
      );
    }
  }

  // Daily stats at 11pm
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() === 0) {
      const top = Object.entries(messageStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const report = top.map(([n, c]) => `${n}: ${c} messages`).join("\n");
      client.sendMessage(
        YOUR_NUMBER,
        `📊 Daily Stats:\n${report || "No messages today lol"}`,
      );
      messageStats = {};
    }
  }, 60000);

  // Morning motivation at 7am
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 7 && now.getMinutes() === 0) {
      const data = await fetchJSON("https://zenquotes.io/api/random");
      client.sendMessage(
        YOUR_NUMBER,
        `🌅 Morning quote:\n"${data[0].q}" — ${data[0].a}`,
      );
    }
  }, 60000);
});

// ─── AUTO VIEW STATUS ───
client.on("status", async (status) => {
  await status.view();
  if (status.hasMedia) {
    if (!fs.existsSync("./statuses")) fs.mkdirSync("./statuses");
    const media = await status.downloadMedia();
    const ext = media.mimetype.split("/")[1];
    fs.writeFileSync(
      `./statuses/status_${Date.now()}.${ext}`,
      Buffer.from(media.data, "base64"),
    );
  }
});

// ─── ANTI DELETE ───
client.on("message_revoke_everyone", async (msg, revoked) => {
  if (!revoked) return;
  const contact = await revoked.getContact();
  const name = contact.pushname || revoked.from;
  await client.sendMessage(
    YOUR_NUMBER,
    `🕵️ ${name} deleted: "${revoked.body || "[media]"}"`,
  );
});

// ─── MESSAGE LOGGER + STATS ───
client.on("message", async (msg) => {
  const contact = await msg.getContact();
  const name = contact.pushname || msg.from;
  log(`${name}: ${msg.body}`);
  if (msg.from !== YOUR_NUMBER) {
    messageStats[name] = (messageStats[name] || 0) + 1;
  }
});

// ─── MAIN HANDLER ───
client.on("message", async (msg) => {
  const from = msg.from;
  const sender = msg.author || msg.from;
  const contact = await msg.getContact();
  const senderJid = contact?.id?._serialized || sender;
  const senderNumber = contact?.number || normalizeJid(senderJid);
  const chat = await msg.getChat();
  const text = (msg.body || "").trim();

  // Debug logging to trace why commands may not be processed
  console.log(
    `[DEBUG] Received message from chat ${from}, sender ${sender}, senderJid=${senderJid}, number=${senderNumber}: "${text}" (isGroup=${chat.isGroup})`,
  );
  console.log(
    `[DEBUG] Contact id=${contact?.id?._serialized || "none"}, number=${contact?.number || "none"}, pushname=${contact?.pushname || "none"}`,
  );
  log(
    `[DEBUG] Received message from chat ${from}, sender ${sender}, senderJid=${senderJid}, number=${senderNumber}: ${text}`,
  );
  console.log(`[DEBUG] Sender is sudo: ${isSudo(senderJid)}`);

  // Auto reply to non-sudo numbers when busy
  if (!isSudo(senderJid) && busyMode) {
    const hour = new Date().getHours();
    const customReply =
      contactReplies[senderJid] || contactReplies[senderNumber];
    if (customReply) {
      msg.reply(customReply);
    } else if (hour >= 0 && hour < 7) {
      msg.reply("I'm asleep lol, I'll reply in the morning");
    } else {
      msg.reply("I'm busy rn lol, I'll reply later");
    }
    await msg.react("👀");
    return;
  }

  // Spam filter in groups
  const bannedWords = ["scam", "spam", "18+"];
  if (chat.isGroup && bannedWords.some((w) => text.toLowerCase().includes(w))) {
    await msg.delete(true);
    return;
  }

  // Only sudo numbers can use commands
  if (!isSudo(senderJid)) return;

  const now = Date.now();
  const lastCmd = lastCommandAt.get(senderJid) || 0;
  if (now - lastCmd < COMMAND_RATE_LIMIT_MS) {
    msg.reply(
      "Slow down please — wait a few seconds before sending another command.",
    );
    return;
  }
  lastCommandAt.set(senderJid, now);

  const intent = detectIntent(text);
  console.log(`[DEBUG] Intent detected: ${intent}`);
  if (!intent) {
    console.log(`[DEBUG] No intent matched for text: "${text}"`);
  }

  try {
    if (!intent) {
      return;
    }
    switch (intent) {
      case "busy_on":
        busyMode = true;
        msg.reply("Busy mode ON lol");
        break;

      case "busy_off":
        busyMode = false;
        msg.reply("Busy mode OFF lol");
        break;

      // ─── SUDO MANAGEMENT ───
      case "sudo_add": {
        const num =
          text
            .replace(/sudo add/i, "")
            .trim()
            .replace("+", "") + "@c.us";
        SUDO_NUMBERS.add(num);
        msg.reply(`${num} can now use the bot lol`);
        break;
      }
      case "sudo_remove": {
        const num =
          text
            .replace(/sudo remove/i, "")
            .trim()
            .replace("+", "") + "@c.us";
        SUDO_NUMBERS.delete(num);
        msg.reply(`${num} removed lol`);
        break;
      }
      case "sudo_list":
        msg.reply("Sudo numbers:\n" + [...SUDO_NUMBERS].join("\n"));
        break;

      // ─── GROUP FEATURES ───
      case "create_group": {
        const name = text.replace(/create group/i, "").trim() || "My Group";
        await client.createGroup(name, [YOUR_NUMBER]);
        msg.reply(`Group "${name}" created lol`);
        break;
      }
      case "list_groups": {
        const chats = await client.getChats();
        const groups = chats.filter((c) => c.isGroup);
        const list = groups
          .map((g) => `${g.name} — ${g.id._serialized}`)
          .join("\n");
        msg.reply(list || "No groups lol");
        break;
      }
      case "kick_all": {
        const groupId = text.split(" ").pop();
        const groupChat = await client.getChatById(groupId);
        const participants = groupChat.participants.filter((p) => !p.isAdmin);
        for (const p of participants)
          await groupChat.removeParticipants([p.id._serialized]);
        msg.reply("Kicked everyone lol");
        break;
      }
      case "promote": {
        const parts = text.split(" ");
        const num = parts[parts.length - 2].replace("+", "") + "@c.us";
        const gid = parts[parts.length - 1];
        const gc = await client.getChatById(gid);
        await gc.promoteParticipants([num]);
        msg.reply(`${num} promoted lol`);
        break;
      }
      case "demote": {
        const parts = text.split(" ");
        const num = parts[parts.length - 2].replace("+", "") + "@c.us";
        const gid = parts[parts.length - 1];
        const gc = await client.getChatById(gid);
        await gc.demoteParticipants([num]);
        msg.reply(`${num} demoted lol`);
        break;
      }
      case "group_name": {
        const parts = text
          .replace(/change group name/i, "")
          .trim()
          .split(" ");
        const gid = parts[0];
        const newName = parts.slice(1).join(" ");
        const gc = await client.getChatById(gid);
        await gc.setSubject(newName);
        msg.reply(`Group name changed to "${newName}" lol`);
        break;
      }

      // ─── BROADCAST ───
      case "broadcast": {
        const bMsg = text.replace(/broadcast/i, "").trim();
        if (!bMsg) {
          msg.reply("Say broadcast followed by a message lol");
          break;
        }

        const now = Date.now();
        if (now - lastBroadcastAt < BROADCAST_RATE_LIMIT_MS) {
          const secondsLeft = Math.ceil(
            (BROADCAST_RATE_LIMIT_MS - (now - lastBroadcastAt)) / 1000,
          );
          msg.reply(
            `Broadcast is on cooldown. Try again in ${secondsLeft} seconds.`,
          );
          break;
        }

        const chats = await client.getChats();
        const recipients = chats
          .filter((c) => !c.isGroup)
          .filter((c) => c.id?._serialized?.endsWith("@c.us"))
          .filter((c) => c.id._serialized !== YOUR_NUMBER)
          .slice(0, MAX_BROADCAST_RECIPIENTS);

        if (!recipients.length) {
          msg.reply("No private chats available for broadcast.");
          break;
        }

        console.log(
          `[DEBUG] Broadcast: sending to ${recipients.length} private chats`,
        );
        for (const c of recipients) {
          const chatId = c.id._serialized;
          try {
            await c.sendMessage(bMsg);
          } catch (error) {
            console.error(
              `[DEBUG] Broadcast failed for chat ${chatId}:`,
              error.message || error,
            );
          }
        }
        lastBroadcastAt = now;

        try {
          await msg.reply(`Broadcast sent to ${recipients.length} contacts.`);
        } catch (error) {
          console.error(
            "[DEBUG] Failed to reply after broadcast:",
            error.message || error,
          );
        }
        break;
      }

      // ─── SCHEDULE ───
      case "schedule": {
        const timeMatch = text.match(/\d{2}:\d{2}/);
        const time = timeMatch ? timeMatch[0] : null;
        const message = text
          .replace(/schedule/i, "")
          .replace(time || "", "")
          .trim();
        if (!time) {
          msg.reply('Give me a time too lol e.g. "schedule 20:00 eat food"');
          break;
        }
        scheduledMessages.push({ time, message });
        msg.reply(`Scheduled "${message}" for ${time} lol`);
        break;
      }

      // ─── CHECK NUMBER ───
      case "info": {
        const num =
          text
            .replace(/check number|is on whatsapp/i, "")
            .trim()
            .replace("+", "") + "@c.us";
        const isReg = await client.isRegisteredUser(num);
        msg.reply(
          isReg ? `That number is on WhatsApp lol` : `Not on WhatsApp lol`,
        );
        break;
      }

      // ─── WEATHER ───
      case "weather": {
        const city = text.replace(/weather/i, "").trim();
        const data = await fetchJSON(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
        );
        const w = data.current_condition[0];
        msg.reply(
          `🌤 Weather in ${city}:\nTemp: ${w.temp_C}°C\nFeels like: ${w.FeelsLikeC}°C\nCondition: ${w.weatherDesc[0].value}`,
        );
        break;
      }

      // ─── CURRENCY ───
      case "currency": {
        const match = text.match(/convert\s+(\d+)\s+(\w+)\s+to\s+(\w+)/i);
        if (!match) {
          msg.reply('Say it like: "convert 5000 NGN to USD" lol');
          break;
        }
        const [, amount, from_cur, to_cur] = match;
        const data = await fetchJSON(
          `https://open.er-api.com/v6/latest/${from_cur.toUpperCase()}`,
        );
        const rate = data.rates[to_cur.toUpperCase()];
        if (!rate) {
          msg.reply("Invalid currency lol");
          break;
        }
        msg.reply(
          `💱 ${amount} ${from_cur.toUpperCase()} = ${(amount * rate).toFixed(2)} ${to_cur.toUpperCase()}`,
        );
        break;
      }

      // ─── DICTIONARY ───
      case "dictionary": {
        const word = text.replace(/define/i, "").trim();
        const data = await fetchJSON(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
        );
        const def = data[0]?.meanings[0]?.definitions[0]?.definition;
        msg.reply(def ? `📖 ${word}: ${def}` : `Word not found lol`);
        break;
      }

      // ─── JOKE ───
      case "joke": {
        const data = await fetchJSON(
          "https://official-joke-api.appspot.com/random_joke",
        );
        msg.reply(`😂 ${data.setup}\n\n${data.punchline}`);
        break;
      }

      // ─── QUOTE ───
      case "quote": {
        const data = await fetchJSON("https://zenquotes.io/api/random");
        msg.reply(`💬 "${data[0].q}" — ${data[0].a}`);
        break;
      }

      // ─── STATS ───
      case "stats": {
        const top = Object.entries(messageStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        const report = top.map(([n, c]) => `${n}: ${c} messages`).join("\n");
        msg.reply(`📊 Stats:\n${report || "No data yet lol"}`);
        break;
      }

      // ─── CUSTOM REPLY PER CONTACT ───
      case "custom_reply": {
        const match = text.match(/set reply for (.+?) as (.+)/i);
        if (!match) {
          msg.reply(
            'Say it like: "set reply for 2348012345678 as I am busy lol"',
          );
          break;
        }
        const num = match[1].replace("+", "") + "@c.us";
        contactReplies[num] = match[2];
        msg.reply(`Custom reply set for ${match[1]} lol`);
        break;
      }

      // ─── SET ABOUT ───
      case "set_about": {
        const aboutText = text.replace(/set about|change about/i, "").trim();
        await client.setStatus(aboutText);
        msg.reply(`About updated to: "${aboutText}" lol`);
        break;
      }

      // ─── VIDEO DOWNLOADER ───
      case "download": {
        msg.reply("Downloading... give me a sec lol");
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
              msg.reply("Download failed lol: " + error.message);
              return;
            }
            const files = fs.readdirSync("./downloads");
            if (!files.length) {
              msg.reply("No file found lol");
              return;
            }
            const filePath = path.join(
              __dirname,
              "downloads",
              files[files.length - 1],
            );
            const media = MessageMedia.fromFilePath(filePath);
            await client.sendMessage(from, media, {
              caption: "Here you go lol",
            });
            fs.unlinkSync(filePath);
          },
        );
        break;
      }

      // ─── TIMER ───
      case "timer": {
        const timeMatch = text.match(/timer\s+(\d+)/i);
        const seconds = timeMatch ? parseInt(timeMatch[1]) : null;
        if (!seconds || seconds <= 0) {
          msg.reply('Give me seconds lol e.g. "timer 60" for 1 minute');
          break;
        }
        if (seconds > 3600) {
          msg.reply("Max 1 hour lol");
          break;
        }
        msg.reply(`⏱️ Timer started for ${seconds} seconds!`);
        const timerId = Date.now();
        userTimers.set(timerId, {
          endTime: Date.now() + seconds * 1000,
          sender: senderJid,
          seconds,
        });
        setTimeout(() => {
          if (userTimers.has(timerId)) {
            client.sendMessage(from, `⏰ Timer done! ${seconds}s is up lol`);
            userTimers.delete(timerId);
          }
        }, seconds * 1000);
        break;
      }

      // ─── CALCULATOR ───
      case "calculator": {
        const expression = text
          .replace(/calc/i, "")
          .trim()
          .replace(/[^0-9+\-*/%().]/g, "");
        if (!expression) {
          msg.reply('Use it like: "calc 5+3*2" or "calc (100-20)/2"');
          break;
        }
        try {
          const result = Function(
            '"use strict"; return (' + expression + ")",
          )();
          msg.reply(`🧮 ${expression} = ${result}`);
        } catch {
          msg.reply("Invalid math expression lol");
        }
        break;
      }

      // ─── NOTE STORAGE ───
      case "note_add": {
        const noteText = text.replace(/note add/i, "").trim();
        if (!noteText) {
          msg.reply('Say: "note add remember to buy milk"');
          break;
        }
        const noteId = notes.length;
        notes.push({ id: noteId, text: noteText, date: new Date() });
        msg.reply(`📝 Note #${noteId} saved!`);
        break;
      }
      case "note_list": {
        if (!notes.length) {
          msg.reply("No notes yet lol");
          break;
        }
        const list = notes.map((n) => `#${n.id}: ${n.text}`).join("\n");
        msg.reply(`📝 Notes:\n${list}`);
        break;
      }
      case "note_delete": {
        const match = text.match(/note delete\s+(\d+)/i);
        const id = match ? parseInt(match[1]) : null;
        if (id === null || !notes[id]) {
          msg.reply("Note not found lol");
          break;
        }
        notes.splice(id, 1);
        msg.reply(`🗑️ Note #${id} deleted!`);
        break;
      }

      // ─── MUSIC SEARCH ───
      case "music": {
        const song = text.replace(/music/i, "").trim();
        if (!song) {
          msg.reply('Say: "music Blinding Lights The Weeknd"');
          break;
        }
        try {
          const data = await fetchJSON(
            `https://itunes.apple.com/search?term=${encodeURIComponent(song)}&media=music&limit=5`,
          );
          if (!data.results.length) {
            msg.reply("No songs found lol");
            break;
          }
          const track = data.results[0];
          msg.reply(
            `🎵 ${track.trackName}\nArtist: ${track.artistName}\n🔗 ${track.trackViewUrl}`,
          );
        } catch {
          msg.reply("Music search failed lol");
        }
        break;
      }

      // ─── DICE ROLLER ───
      case "dice": {
        const diceMatch = text.match(/dice|roll\s+(\w+)/i);
        let diceType = "d6";
        if (diceMatch && diceMatch[1]) {
          diceType = diceMatch[1].toLowerCase();
        }
        const diceMap = {
          d4: 4,
          d6: 6,
          d8: 8,
          d10: 10,
          d12: 12,
          d20: 20,
          d100: 100,
        };
        const sides = diceMap[diceType] || 6;
        const result = Math.floor(Math.random() * sides) + 1;
        msg.reply(`🎲 ${diceType.toUpperCase()} rolled: ${result}`);
        break;
      }

      // ─── RANDOM FACT ───
      case "fact": {
        try {
          const data = await fetchJSON(
            "https://uselessfacts.jsoup.com/random.json?language=en",
          );
          msg.reply(`📚 ${data.text}`);
        } catch {
          const facts = [
            "Honey never spoils lol",
            "A group of flamingos is called a flamboyance",
            "Octopuses have 3 hearts lol",
            "Bananas are berries but strawberries aren't",
            "A pizza hut in space was delivered in 2001",
          ];
          msg.reply(`📚 ${facts[Math.floor(Math.random() * facts.length)]}`);
        }
        break;
      }

      // ─── COIN FLIP ───
      case "flip": {
        const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
        msg.reply(`Flipping... ${result}`);
        break;
      }

      // ─── TODO LIST ───
      case "todo_add": {
        const task = text.replace(/todo add/i, "").trim();
        if (!task) {
          msg.reply('Say: "todo add buy groceries"');
          break;
        }
        const todoId = todos.length;
        todos.push({ id: todoId, text: task, done: false });
        msg.reply(`✅ Todo #${todoId} added!`);
        break;
      }
      case "todo_list": {
        if (!todos.length) {
          msg.reply("No todos yet lol");
          break;
        }
        const list = todos
          .map((t) => `${t.done ? "✓" : "○"} #${t.id}: ${t.text}`)
          .join("\n");
        msg.reply(`📋 Todos:\n${list}`);
        break;
      }
      case "todo_done": {
        const match = text.match(/todo done\s+(\d+)/i);
        const id = match ? parseInt(match[1]) : null;
        if (id === null || !todos[id]) {
          msg.reply("Todo not found lol");
          break;
        }
        todos[id].done = !todos[id].done;
        msg.reply(`${todos[id].done ? "✓" : "○"} Todo #${id} marked!`);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error("[DEBUG] Command handler error:", error);
    msg.reply("Oops, something went wrong lol");
  }
});

// ─── SCHEDULED CHECKER ───
function checkScheduled() {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  scheduledMessages = scheduledMessages.filter((s) => {
    if (s.time === currentTime) {
      client.sendMessage(YOUR_NUMBER, s.message);
      return false;
    }
    return true;
  });
}

// Prompt for owner number if missing, then initialize the client
async function ensureOwnerNumber() {
  if (YOUR_NUMBER) {
    YOUR_NUMBER = String(YOUR_NUMBER).trim();
    // sanitize
    YOUR_NUMBER = YOUR_NUMBER.replace(/\D/g, "");
    if (!YOUR_NUMBER.endsWith("@c.us")) YOUR_NUMBER = YOUR_NUMBER + "@c.us";
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "No owner number provided and stdin is not interactive. Set YOUR_NUMBER env var.",
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((resolve) => {
    rl.question(
      "Enter your phone number with country code (e.g. 2349016002865): ",
      (ans) => {
        rl.close();
        resolve(ans || "");
      },
    );
  });

  YOUR_NUMBER = String(answer).trim().replace(/\D/g, "");
  if (!YOUR_NUMBER) {
    console.error("No number entered — exiting.");
    process.exit(1);
  }
  if (!YOUR_NUMBER.endsWith("@c.us")) YOUR_NUMBER = YOUR_NUMBER + "@c.us";
}

ensureOwnerNumber()
  .then(() => {
    // ensure owner is a sudo user
    if (YOUR_NUMBER) SUDO_NUMBERS.add(YOUR_NUMBER);
    client.initialize();
  })
  .catch((err) => {
    console.error("Failed to set owner number:", err);
    process.exit(1);
  });
