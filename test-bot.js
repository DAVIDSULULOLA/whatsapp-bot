/**
 * Test Harness for WhatsApp Bot
 * Run: node test-bot.js
 * Simulates incoming messages and prints command responses
 */

// Mock WhatsApp message object
class MockMessage {
  constructor(body, from = "2348132329609@c.us", isGroup = false) {
    this.body = body;
    this.from = from;
    this.author = from;
    this.isGroup = isGroup;
    this.id = { _serialized: `msg_${Date.now()}` };
    this.replies = [];
    this.reactions = [];
  }

  async reply(text) {
    this.replies.push(text);
    console.log(`  ✉️  Bot reply: ${text}`);
  }

  async react(emoji) {
    this.reactions.push(emoji);
  }
}

class MockChat {
  constructor(isGroup = false) {
    this.isGroup = isGroup;
    this.id = { _serialized: "mock_chat_123@c.us" };
  }
}

class MockContact {
  constructor(pushname, number) {
    this.pushname = pushname;
    this.number = number;
    this.id = { _serialized: number };
  }
}

// Import and setup bot config
const YOUR_NUMBER = "2349016002865@c.us";
const SUDO_NUMBERS = new Set(["2349016002865@c.us", "2348132329609@c.us"]);

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

// Helper functions from main bot
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

// Enhanced test cases with edge cases and error handling
const tests = [
  // ─── AUTHENTICATION TESTS ───
  {
    category: "Authentication",
    name: "Sudo user allowed",
    message: new MockMessage("stats", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Authentication",
    name: "Non-sudo user rejected",
    message: new MockMessage("stats", "1234567890@c.us"),
    shouldAllow: false,
  },
  {
    category: "Authentication",
    name: "Owner number allowed",
    message: new MockMessage("stats", "2349016002865@c.us"),
    shouldAllow: true,
  },
  {
    category: "Authentication",
    name: "Empty sender rejected",
    message: new MockMessage("stats", ""),
    shouldAllow: false,
  },

  // ─── INTENT DETECTION TESTS ───
  {
    category: "Intent Detection",
    name: "Busy on (exact)",
    message: new MockMessage("busy on", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Intent Detection",
    name: "Busy on (with spaces)",
    message: new MockMessage("  busy on  ", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Intent Detection",
    name: "Busy on (uppercase)",
    message: new MockMessage("BUSY ON", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Intent Detection",
    name: "Busy off",
    message: new MockMessage("busy off", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Intent Detection",
    name: "Broadcast with message",
    message: new MockMessage("broadcast hello everyone", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Intent Detection",
    name: "Broadcast empty (should detect intent)",
    message: new MockMessage("broadcast", "2348132329609@c.us"),
    shouldAllow: true,
  },

  // ─── PARAMETER VALIDATION TESTS ───
  {
    category: "Parameter Validation",
    name: "Schedule with valid time",
    message: new MockMessage("schedule 20:00 eat food", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Parameter Validation",
    name: "Schedule with invalid time format",
    message: new MockMessage("schedule 25:99 bad time", "2348132329609@c.us"),
    shouldAllow: true, // Intent detected but should error gracefully
  },
  {
    category: "Parameter Validation",
    name: "Schedule missing time",
    message: new MockMessage("schedule message only", "2348132329609@c.us"),
    shouldAllow: true, // Intent detected, param check at runtime
  },
  {
    category: "Parameter Validation",
    name: "Currency convert valid",
    message: new MockMessage("convert 5000 NGN to USD", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Parameter Validation",
    name: "Currency convert missing params",
    message: new MockMessage("convert 5000", "2348132329609@c.us"),
    shouldAllow: true, // Intent detected
  },

  // ─── API COMMAND TESTS ───
  {
    category: "API Commands",
    name: "Weather command",
    message: new MockMessage("weather Lagos", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "API Commands",
    name: "Quote command",
    message: new MockMessage("quote", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "API Commands",
    name: "Joke command",
    message: new MockMessage("joke", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "API Commands",
    name: "Define word",
    message: new MockMessage("define serendipity", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "API Commands",
    name: "Define without word",
    message: new MockMessage("define", "2348132329609@c.us"),
    shouldAllow: true, // Intent detected
  },

  // ─── GROUP MANAGEMENT TESTS ───
  {
    category: "Group Management",
    name: "Create group",
    message: new MockMessage("create group Developers", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Group Management",
    name: "List groups",
    message: new MockMessage("my groups", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Group Management",
    name: "Change group name",
    message: new MockMessage(
      "change group name abc123 New Name",
      "2348132329609@c.us",
    ),
    shouldAllow: true,
  },

  // ─── SUDO MANAGEMENT TESTS ───
  {
    category: "Sudo Management",
    name: "Sudo list",
    message: new MockMessage("sudo list", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Sudo Management",
    name: "Sudo add number",
    message: new MockMessage("sudo add 2341234567890", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Sudo Management",
    name: "Sudo remove number",
    message: new MockMessage("sudo remove 2341234567890", "2348132329609@c.us"),
    shouldAllow: true,
  },

  // ─── EDGE CASES ───
  {
    category: "Edge Cases",
    name: "Very long message",
    message: new MockMessage(
      "broadcast " + "hello ".repeat(100),
      "2348132329609@c.us",
    ),
    shouldAllow: true,
  },
  {
    category: "Edge Cases",
    name: "Special characters in command",
    message: new MockMessage(
      'broadcast "hello @everyone"',
      "2348132329609@c.us",
    ),
    shouldAllow: true,
  },
  {
    category: "Edge Cases",
    name: "Multiple spaces in command",
    message: new MockMessage("broadcast  hello   world", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "Edge Cases",
    name: "Empty message",
    message: new MockMessage("", "2348132329609@c.us"),
    shouldAllow: false,
  },
  {
    category: "Edge Cases",
    name: "Only whitespace",
    message: new MockMessage("   ", "2348132329609@c.us"),
    shouldAllow: false,
  },
  {
    category: "Edge Cases",
    name: "SQL injection attempt",
    message: new MockMessage("'; DROP TABLE--", "2348132329609@c.us"),
    shouldAllow: false,
  },
  {
    category: "Edge Cases",
    name: "Unicode/emoji in command",
    message: new MockMessage("quote 😀 🎉", "2348132329609@c.us"),
    shouldAllow: true,
  },

  // ─── NON-COMMAND MESSAGES ───
  {
    category: "Non-Command Messages",
    name: "Regular chat (no command)",
    message: new MockMessage(
      "Hey how are you doing today?",
      "2348132329609@c.us",
    ),
    shouldAllow: false, // No command detected
  },
  {
    category: "Non-Command Messages",
    name: "Status update",
    message: new MockMessage("Just vibing 🎵", "2348132329609@c.us"),
    shouldAllow: false,
  },

  // ─── NEW FEATURES TESTS ───
  {
    category: "New Features",
    name: "Timer 60 seconds",
    message: new MockMessage("timer 60", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Calculator expression",
    message: new MockMessage("calc 5+3*2", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Note add",
    message: new MockMessage("note add buy milk", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Note list",
    message: new MockMessage("note list", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Note delete",
    message: new MockMessage("note delete 0", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Music search",
    message: new MockMessage("music Bohemian Rhapsody", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Dice roll d20",
    message: new MockMessage("roll d20", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Dice roll (default)",
    message: new MockMessage("dice", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Random fact",
    message: new MockMessage("fact", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Coin flip",
    message: new MockMessage("flip", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Todo add",
    message: new MockMessage("todo add finish homework", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Todo list",
    message: new MockMessage("todo list", "2348132329609@c.us"),
    shouldAllow: true,
  },
  {
    category: "New Features",
    name: "Todo done",
    message: new MockMessage("todo done 0", "2348132329609@c.us"),
    shouldAllow: true,
  },
];

// Run tests
console.log("🤖 WhatsApp Bot Command Validation Suite\n");
console.log("=".repeat(70));

// Group tests by category
const grouped = {};
tests.forEach((test) => {
  if (!grouped[test.category]) {
    grouped[test.category] = [];
  }
  grouped[test.category].push(test);
});

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Run grouped tests
Object.entries(grouped).forEach(([category, categoryTests]) => {
  console.log(`\n📂 ${category}`);
  console.log("-".repeat(70));

  categoryTests.forEach((test) => {
    totalTests++;
    const msg = test.message;
    const sender = msg.author || msg.from;
    const isSudoUser = isSudo(sender);
    const intent = detectIntent(msg.body);

    const allowed = isSudoUser && intent !== null && msg.body.trim().length > 0;
    const passed = allowed === test.shouldAllow;

    if (passed) {
      passedTests++;
      console.log(`  ✅ ${test.name}`);
    } else {
      failedTests++;
      console.log(`  ❌ ${test.name}`);
      console.log(
        `     Expected: ${test.shouldAllow}, Got: ${allowed} | Intent: ${intent}`,
      );
    }
  });
});

console.log("\n" + "=".repeat(70));
console.log("\n📊 Test Results Summary");
console.log(`  Total Tests: ${totalTests}`);
console.log(`  ✅ Passed: ${passedTests}`);
console.log(`  ❌ Failed: ${failedTests}`);
console.log(
  `  Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`,
);
console.log("\n📋 Available Commands:\n");
COMMAND_LIST.forEach((cmd, i) => {
  console.log(`  ${i + 1}. ${cmd}`);
});
console.log("\n✅ Test suite complete.\n");
