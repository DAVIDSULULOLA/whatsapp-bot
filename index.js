const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const readline = require("readline");

// ─── ASK FOR OWNER NUMBER ON STARTUP ───
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let YOUR_NUMBER = "";
const SUDO_NUMBERS = new Set(["2348132329609@c.us"]);

rl.question("Enter your WhatsApp number (e.g. 2348012345678): ", (number) => {
  YOUR_NUMBER = number.trim().replace("+", "") + "@c.us";
  SUDO_NUMBERS.add(YOUR_NUMBER);
  console.log(`✅ Owner set to: ${YOUR_NUMBER}`);
  console.log(`✅ Sudo numbers: ${[...SUDO_NUMBERS].join(", ")}`);
  rl.close();
  startBot();
});

function startBot() {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      executablePath:
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

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

  function normalizeJid(jid) {
    if (!jid) return "";
    const val = jid.toString().toLowerCase();
    if (val.includes("@")) {
      return val.split("@")[0].replace(/\D/g, "");
    }
    return val.replace(/\D/g, "").replace(/^0+/, "");
  }

  function isSudo(number, senderJid, contactId) {
    if (!number && !senderJid && !contactId) return false;
    console.log(`[SUDO CHECK] SUDO_NUMBERS: ${[...SUDO_NUMBERS].join(", ")}`);
    console.log(
      `[SUDO CHECK] Checking number=${normalizeJid(number)} senderJid=${normalizeJid(senderJid)} contactId=${normalizeJid(contactId)}`,
    );
    return [...SUDO_NUMBERS].some((n) => {
      const norm = normalizeJid(n);
      console.log(
        `[SUDO CHECK] Comparing norm=${norm} against number=${normalizeJid(number)} senderJid=${normalizeJid(senderJid)} contactId=${normalizeJid(contactId)}`,
      );
      return (
        norm === normalizeJid(number) ||
        norm === normalizeJid(senderJid) ||
        norm === normalizeJid(contactId)
      );
    });
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

  // ─── QR & READY ───
  client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    console.log("Scan QR lol");
  });
  client.on("ready", () => {
    console.log("Bot is live lol");
    setInterval(checkScheduled, 60000);

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
    const text = msg.body.trim();
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const from = contact.id._serialized; // ALWAYS use this as the real number
    const senderJid = msg.author || msg.from;
    const contactId = contact.id._serialized;

    console.log(
      `[DEBUG] Received message from ${from}, senderJid=${senderJid}, contactId=${contactId}: "${text}"`,
    );
    console.log(
      `[DEBUG] Contact id=${contactId}, pushname=${contact.pushname}`,
    );

    // Auto reply when busy
    if (!isSudo(from, senderJid, contactId) && busyMode) {
      const hour = new Date().getHours();
      const customReply = contactReplies[from];
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
    if (
      chat.isGroup &&
      bannedWords.some((w) => text.toLowerCase().includes(w))
    ) {
      await msg.delete(true);
      return;
    }

    // Only sudo numbers can use commands
    if (!isSudo(from, senderJid, contactId)) {
      console.log(`[DEBUG] Sender is sudo: false`);
      return;
    }

    console.log(`[DEBUG] Sender is sudo: true ✅`);
    const intent = detectIntent(text);
    if (!intent) return;

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
        if (num === YOUR_NUMBER) {
          msg.reply("Can't remove the owner lol");
          break;
        }
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
          msg.reply("Give me a message to broadcast lol");
          break;
        }
        const chats = await client.getChats();
        let count = 0;
        for (const c of chats) {
          if (!c.isGroup && count < 20) {
            await c.sendMessage(bMsg);
            count++;
          }
        }
        msg.reply(`Broadcast sent to ${count} chats lol`);
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
        if (!city) {
          msg.reply("Tell me the city lol");
          break;
        }
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
        if (!word) {
          msg.reply("Tell me the word lol");
          break;
        }
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

      // ─── CUSTOM REPLY ───
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

      // ─── TIMER ───
      case "timer": {
        const seconds = parseInt(text.replace(/timer/i, "").trim());
        if (isNaN(seconds) || seconds <= 0 || seconds > 3600) {
          msg.reply("Give me a valid time in seconds (max 3600) lol");
          break;
        }
        msg.reply(`⏱ Timer set for ${seconds} seconds lol`);
        setTimeout(() => {
          client.sendMessage(
            from,
            `⏰ Timer done! ${seconds} seconds are up lol`,
          );
        }, seconds * 1000);
        break;
      }

      // ─── CALCULATOR ───
      case "calculator": {
        const expr = text.replace(/calc/i, "").trim();
        try {
          const result = Function(`"use strict"; return (${expr})`)();
          msg.reply(`🧮 ${expr} = ${result}`);
        } catch {
          msg.reply("Invalid expression lol");
        }
        break;
      }

      // ─── NOTES ───
      case "note_add": {
        const note = text.replace(/note add/i, "").trim();
        if (!note) {
          msg.reply("Give me something to save lol");
          break;
        }
        notes.push(note);
        msg.reply(`📝 Note saved: "${note}" lol`);
        break;
      }
      case "note_list": {
        if (!notes.length) {
          msg.reply("No notes yet lol");
          break;
        }
        msg.reply(
          "📝 Notes:\n" + notes.map((n, i) => `#${i}: ${n}`).join("\n"),
        );
        break;
      }
      case "note_delete": {
        const id = parseInt(text.replace(/note delete/i, "").trim());
        if (isNaN(id) || !notes[id]) {
          msg.reply("Invalid note ID lol");
          break;
        }
        const deleted = notes.splice(id, 1);
        msg.reply(`Deleted note: "${deleted[0]}" lol`);
        break;
      }

      // ─── TODOS ───
      case "todo_add": {
        const task = text.replace(/todo add/i, "").trim();
        if (!task) {
          msg.reply("Give me a task lol");
          break;
        }
        todos.push({ task, done: false });
        msg.reply(`✅ Todo added: "${task}" lol`);
        break;
      }
      case "todo_list": {
        if (!todos.length) {
          msg.reply("No todos yet lol");
          break;
        }
        msg.reply(
          "📋 Todos:\n" +
            todos
              .map((t, i) => `#${i}: ${t.done ? "✅" : "⬜"} ${t.task}`)
              .join("\n"),
        );
        break;
      }
      case "todo_done": {
        const id = parseInt(text.replace(/todo done/i, "").trim());
        if (isNaN(id) || !todos[id]) {
          msg.reply("Invalid todo ID lol");
          break;
        }
        todos[id].done = !todos[id].done;
        msg.reply(
          `Todo #${id} marked as ${todos[id].done ? "done ✅" : "undone ⬜"} lol`,
        );
        break;
      }

      // ─── MUSIC ───
      case "music": {
        const song = text.replace(/music/i, "").trim();
        if (!song) {
          msg.reply("Tell me the song name lol");
          break;
        }
        const data = await fetchJSON(
          `https://itunes.apple.com/search?term=${encodeURIComponent(song)}&media=music&limit=3`,
        );
        if (!data.results.length) {
          msg.reply("Song not found lol");
          break;
        }
        const results = data.results
          .map(
            (r) => `🎵 ${r.trackName} — ${r.artistName}\n🔗 ${r.trackViewUrl}`,
          )
          .join("\n\n");
        msg.reply(results);
        break;
      }

      // ─── DICE ───
      case "dice": {
        const diceMatch = text.match(/d(\d+)/i);
        const sides = diceMatch ? parseInt(diceMatch[1]) : 6;
        const roll = Math.floor(Math.random() * sides) + 1;
        msg.reply(`🎲 You rolled a d${sides}: ${roll} lol`);
        break;
      }

      // ─── FACT ───
      case "fact": {
        const data = await fetchJSON(
          "https://uselessfacts.jsoup.com/api/v1/facts/random?language=en",
        );
        msg.reply(`🤓 ${data.text}`);
        break;
      }

      // ─── FLIP ───
      case "flip": {
        const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
        msg.reply(`Coin flip: ${result} lol`);
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

      default:
        break;
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

  client.initialize();
}
