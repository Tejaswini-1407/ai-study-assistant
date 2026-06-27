import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import os from "os";
import { GoogleGenAI } from "@google/genai";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((error) => console.log("MongoDB error:", error.message));

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

const StudySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fileName: String,
    summary: String,
    quiz: Array,
    flashcards: Array,
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
const Study = mongoose.model("Study", StudySchema);

const app = express();
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  })
);
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function createToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function askGeminiWithPdf(filePath, prompt) {
  try {
    const fileData = fs.readFileSync(filePath);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: fileData.toString("base64"),
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    });

    return response.text;
  } finally {
    fs.unlink(filePath, () => {});
  }
}

function parseJsonText(text) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

function handleAiError(error, res, fallbackMessage) {
  const message = error?.message || "";
  const lowerMessage = message.toLowerCase();

  if (
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    lowerMessage.includes("quota") ||
    lowerMessage.includes("rate limit")
  ) {
    return res.status(429).json({
      error: "Gemini quota exceeded",
      details:
        "The AI request limit has been reached. Please try again later or upgrade your Gemini API quota.",
    });
  }

  if (error instanceof SyntaxError) {
    return res.status(502).json({
      error: "AI response format error",
      details:
        "The AI returned data in an unexpected format. Please try generating this again.",
    });
  }

  return res.status(500).json({
    error: fallbackMessage,
    details: message || "Unexpected AI service error",
  });
}

app.get("/", (req, res) => {
  res.json({ message: "AI Study Assistant API is running" });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({
      token: createToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Signup failed",
      details: error.message,
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json({
      token: createToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Login failed",
      details: error.message,
    });
  }
});

app.post("/api/summarize", requireAuth, upload.single("pdf"), async (req, res) => {
  try {
    const summary = await askGeminiWithPdf(
      req.file.path,
      `Summarize this PDF into clean student notes.

Rules:
- Do not start with "Here's a summary"
- Do not use markdown code blocks
- Use clear headings
- Use bullet points
- If the PDF contains tables, recreate them as GitHub-Flavored Markdown tables using pipe syntax
- Keep table columns short and readable
- Put tables under the most relevant heading
- Keep it easy to revise for exams`
    );

    res.json({ result: summary });
  } catch (error) {
    handleAiError(error, res, "Summary generation failed");
  }
});

app.post("/api/ask", requireAuth, upload.single("pdf"), async (req, res) => {
  try {
    const answer = await askGeminiWithPdf(
      req.file.path,
      `Answer this question using only the PDF.

Question: ${req.body.question}`
    );

    res.json({ result: answer });
  } catch (error) {
    handleAiError(error, res, "Question answering failed");
  }
});

app.post("/api/quiz", requireAuth, upload.single("pdf"), async (req, res) => {
  try {
    const quizText = await askGeminiWithPdf(
      req.file.path,
      `Create 10 multiple-choice quiz questions from this PDF.

Return only valid JSON. Do not include markdown.

Use this exact format:
[
  {
    "question": "Question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": "Correct option text",
    "explanation": "Short explanation"
  }
]`
    );

    const quiz = parseJsonText(quizText);

    res.json({ result: quiz });
  } catch (error) {
    handleAiError(error, res, "Quiz generation failed");
  }
});

app.post("/api/flashcards", requireAuth, upload.single("pdf"), async (req, res) => {
  try {
    const flashcardText = await askGeminiWithPdf(
      req.file.path,
      `Create useful study flashcards from this PDF.

Return only valid JSON. Do not include markdown.

Use this exact format:
[
  {
    "front": "Question or key term",
    "back": "Answer or explanation"
  }
]`
    );

    const flashcards = parseJsonText(flashcardText);

    res.json({ result: flashcards });
  } catch (error) {
    handleAiError(error, res, "Flashcard generation failed");
  }
});

app.post("/api/save", requireAuth, async (req, res) => {
  try {
    const savedStudy = await Study.create({
      userId: req.user.id,
      fileName: req.body.fileName,
      summary: req.body.summary,
      quiz: req.body.quiz,
      flashcards: req.body.flashcards,
    });

    res.json(savedStudy);
  } catch (error) {
    res.status(500).json({
      error: "Save failed",
      details: error.message,
    });
  }
});

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const history = await Study.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(history);
  } catch (error) {
    res.status(500).json({
      error: "History fetch failed",
      details: error.message,
    });
  }
});

app.delete("/api/history/:id", requireAuth, async (req, res) => {
  try {
    const deletedStudy = await Study.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!deletedStudy) {
      return res.status(404).json({ error: "Study set not found" });
    }

    res.json({ message: "Study set deleted" });
  } catch (error) {
    res.status(500).json({
      error: "Delete failed",
      details: error.message,
    });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running on http://localhost:5000");
});
