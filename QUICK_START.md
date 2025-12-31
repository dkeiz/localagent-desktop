# Quick Start Guide - New Features

## 🚀 Getting Started with New Features

### 1. Using Async Chat (Non-Blocking Input)

**Before**: Had to wait for AI response before sending next message  
**Now**: Send multiple messages anytime!

**How to use**:
```
1. Type your message
2. Click Send (or press Enter)
3. Keep typing! Don't wait for response
4. Send more messages while AI is thinking
```

**Example workflow**:
```
You: "What's the weather like?"  [Send]
You: "Also, what's 2+2?"         [Send immediately]
You: "And tell me a joke"        [Send immediately]

AI will respond to all three in order!
```

---

### 2. Creating Custom Rules

**What are rules?**  
Short instructions that modify AI behavior (e.g., "be brief", "use JSON", "technical language")

**How to create a rule**:
```
1. Click "LLM Settings" tab (🤖 icon)
2. Scroll to "Custom Rules" section
3. Click "+ Add Rule" button
4. Fill in:
   - Name: "Concise Mode"
   - Content: "Answer in maximum 20 words"
5. Click "Add Rule"
```

**How to use rules**:
```
✅ Check the box = Rule is ACTIVE (AI will follow it)
☐ Uncheck the box = Rule is INACTIVE (AI ignores it)
```

**Example rules to try**:

```
Name: "Super Brief"
Content: "Answer only in 20 words or less. Be extremely concise."

Name: "Code Expert"
Content: "Always include code examples. Use technical terminology."

Name: "JSON Output"
Content: "Always respond in valid JSON format."

Name: "Friendly Tone"
Content: "Use casual, friendly language. Add emojis occasionally."

Name: "Step by Step"
Content: "Break down answers into numbered steps."
```

**Managing rules**:
- ✅ Toggle checkbox to activate/deactivate
- 🗑️ Click trash icon to delete
- Multiple rules can be active at once!

---

### 3. Starting a New Chat

**When to use**:
- Switching to a completely different topic
- AI seems confused by previous context
- Want a fresh start

**How to use**:
```
1. Click "🆕 New Chat" button (top of chat)
2. Confirm "Yes" in the dialog
3. Chat history cleared - fresh start!
```

**Note**: This clears the conversation context, not your settings or rules!

---

### 4. Using the Real Calendar

**What's new**:
- Shows actual current month and year
- Today's date highlighted in GREEN
- Month/year displayed in header

**Visual guide**:
```
🟢 Green background = TODAY
🔵 Blue background = Selected date
⚪ White background = Other dates
```

**How to use**:
```
1. Look at calendar widget (right side)
2. Today is automatically highlighted
3. Click any date to select it
4. Add events with "Add Event" button
```

---

## 💡 Pro Tips

### Tip 1: Rule Combinations
Activate multiple rules for complex behavior:
```
✅ "Concise Mode" (20 words max)
✅ "Code Expert" (include code)
= Short, technical answers with code!
```

### Tip 2: Async Workflow
Queue related questions:
```
"Explain async/await"     [Send]
"Show me an example"      [Send]
"What are common errors?" [Send]

All sent before first response arrives!
```

### Tip 3: Rule Testing
Create a test rule to verify behavior:
```
Name: "Test Rule"
Content: "Start every response with 'TEST MODE:'"

Activate it, ask a question, see if it works!
```

### Tip 4: Context Management
Use New Chat strategically:
```
Topic 1: Coding questions → New Chat
Topic 2: Recipe ideas → New Chat
Topic 3: Travel planning → New Chat
```

---

## 🎯 Common Use Cases

### Use Case 1: Quick Research
```
1. Activate "Concise Mode" rule
2. Send multiple questions rapidly
3. Get brief answers to all
4. Deactivate rule for detailed follow-ups
```

### Use Case 2: Code Development
```
1. Activate "Code Expert" rule
2. Ask coding questions
3. Get code examples automatically
4. Keep rule active for entire session
```

### Use Case 3: Data Analysis
```
1. Activate "JSON Output" rule
2. Ask for data/statistics
3. Get structured JSON responses
4. Easy to parse programmatically
```

### Use Case 4: Learning Mode
```
1. Activate "Step by Step" rule
2. Ask complex questions
3. Get numbered, clear explanations
4. Easy to follow and understand
```

---

## 🔧 Troubleshooting

### Problem: AI not following my rule
**Solution**: 
- Check if rule is activated (checkbox checked)
- Make rule more specific
- Try rephrasing the rule content

### Problem: Too many active rules conflicting
**Solution**:
- Deactivate some rules
- Keep only 2-3 active at once
- Create separate rules for different scenarios

### Problem: Want to reset everything
**Solution**:
- Click "New Chat" to clear conversation
- Deactivate all rules
- Fresh start!

### Problem: Calendar not showing today
**Solution**:
- Refresh the app
- Check system date/time settings
- Today should auto-highlight in green

---

## 📚 Keyboard Shortcuts

```
Enter          = Send message (without Shift)
Shift + Enter  = New line in message
```

---

## 🎨 Visual Guide

### Chat Interface
```
┌─────────────────────────────────┐
│  [🆕 New Chat]                  │ ← New button!
├─────────────────────────────────┤
│  User: Hello                    │
│  AI: Hi there!                  │
│  AI: ... (loading)              │ ← Loading indicator
├─────────────────────────────────┤
│  [Type message...] [Send]       │ ← Never blocked!
└─────────────────────────────────┘
```

### Rules Section
```
┌─────────────────────────────────┐
│  Custom Rules                   │
├─────────────────────────────────┤
│  ☑ Concise Mode                 │ 🗑️
│     Answer in 20 words max      │
├─────────────────────────────────┤
│  ☐ JSON Output                  │ 🗑️
│     Respond in JSON format      │
├─────────────────────────────────┤
│  [+ Add Rule]                   │
└─────────────────────────────────┘
```

### Calendar Widget
```
┌─────────────────────────────────┐
│  December 2024                  │ ← Real month/year!
├─────────────────────────────────┤
│  S  M  T  W  T  F  S           │
│  1  2  3  4  5  6  7           │
│  8  9 [10] 11 12 13 14         │ ← Today (green)
│  15 16 17 18 19 20 21          │
└─────────────────────────────────┘
```

---

## 🎓 Learning Path

**Day 1**: Try async chat
- Send multiple messages
- Notice no blocking

**Day 2**: Create your first rule
- Make a "Concise Mode" rule
- Toggle it on/off
- See the difference

**Day 3**: Experiment with combinations
- Activate 2-3 rules together
- See how they interact
- Find your favorite combo

**Day 4**: Master context management
- Use New Chat for topic switches
- Keep related questions in same chat
- Organize your workflow

**Week 2**: Advanced usage
- Create rule library
- Develop personal rule profiles
- Optimize your AI interactions

---

## 🌟 Best Practices

1. **Name rules clearly**: "Concise Mode" not "Rule 1"
2. **Keep rules simple**: One instruction per rule
3. **Test before relying**: Verify rule behavior first
4. **Deactivate when done**: Don't leave rules active unnecessarily
5. **Use New Chat**: Fresh context for new topics
6. **Queue questions**: Take advantage of async chat
7. **Organize rules**: Delete unused rules regularly

---

## 🎉 You're Ready!

Start using these features now:
1. ✅ Send messages without waiting
2. ✅ Create custom rules for AI behavior
3. ✅ Start new chats when needed
4. ✅ See real dates in calendar

**Have fun and be productive!** 🚀

---

**Need help?** Check `FEATURES.md` for detailed documentation.
