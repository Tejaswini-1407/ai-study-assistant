import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function App() {
  const savedToken = localStorage.getItem("studyAssistantToken");
  const savedUser = localStorage.getItem("studyAssistantUser");

  const [token, setToken] = useState(savedToken || "");
  const [user, setUser] = useState(savedUser ? JSON.parse(savedUser) : null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [pdf, setPdf] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [summary, setSummary] = useState("");
  const [quiz, setQuiz] = useState([]);
  const [flashcards, setFlashcards] = useState([]);
  const [flippedCards, setFlippedCards] = useState({});
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  const answeredCount = Object.keys(selectedAnswers).length;
  const correctCount = quiz.reduce((total, item, index) => {
    return selectedAnswers[index] === item.answer ? total + 1 : total;
  }, 0);
  const quizScore = quiz.length > 0 ? Math.round((correctCount / quiz.length) * 100) : 0;

  const api = useMemo(
    () =>
      axios.create({
        baseURL: API_URL,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    [token]
  );

  useEffect(() => {
    if (token) {
      loadHistory();
    }
  }, [token]);

  function updateAuthForm(event) {
    setAuthForm({
      ...authForm,
      [event.target.name]: event.target.value,
    });
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError("");
    setLoading("auth");

    try {
      const payload =
        authMode === "signup"
          ? authForm
          : { email: authForm.email, password: authForm.password };

      const response = await axios.post(`${API_URL}/api/auth/${authMode}`, payload);

      localStorage.setItem("studyAssistantToken", response.data.token);
      localStorage.setItem("studyAssistantUser", JSON.stringify(response.data.user));
      setToken(response.data.token);
      setUser(response.data.user);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (err) {
      setAuthError(
        err.response?.data?.details ||
          err.response?.data?.error ||
          "Authentication failed."
      );
    }

    setLoading("");
  }

  function logout() {
    localStorage.removeItem("studyAssistantToken");
    localStorage.removeItem("studyAssistantUser");
    setToken("");
    setUser(null);
    setHistory([]);
    clearStudy();
  }

  function clearStudy() {
    setPdf(null);
    setQuestion("");
    setAnswer("");
    setSummary("");
    setQuiz([]);
    setFlashcards([]);
    setFlippedCards({});
    setSelectedAnswers({});
    setError("");
  }

  async function sendRequest(type) {
    if (!pdf) {
      setError("Please upload a PDF first.");
      return;
    }

    if (type === "ask" && !question.trim()) {
      setError("Please type a question first.");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", pdf);

    if (type === "ask") {
      formData.append("question", question);
    }

    setLoading(type);
    setError("");

    try {
      const response = await api.post(`/api/${type}`, formData);

      if (type === "summarize") {
        setSummary(response.data.result);
      }

      if (type === "ask") {
        setAnswer(response.data.result);
      }

      if (type === "quiz") {
        setQuiz(response.data.result);
        setSelectedAnswers({});
      }

      if (type === "flashcards") {
        setFlashcards(response.data.result);
        setFlippedCards({});
      }
    } catch (err) {
      setError(err.response?.data?.details || err.response?.data?.error || "Something went wrong.");
    }

    setLoading("");
  }

  function copySummary() {
    navigator.clipboard.writeText(summary);
    setError("Summary copied.");
  }

  function downloadSummary() {
    const blob = new Blob([summary], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "study-notes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveStudy() {
    if (!summary && quiz.length === 0 && flashcards.length === 0) {
      setError("Generate summary, quiz, or flashcards before saving.");
      return;
    }

    setLoading("save");
    setError("");

    try {
      await api.post("/api/save", {
        fileName: pdf?.name || "Untitled PDF",
        summary,
        quiz,
        flashcards,
      });

      await loadHistory();
      setError("Study set saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Save failed.");
    }

    setLoading("");
  }

  async function loadHistory() {
    try {
      const response = await api.get("/api/history");
      setHistory(response.data);
    } catch (err) {
      setHistory([]);
    }
  }

  async function deleteStudy(id) {
    try {
      await api.delete(`/api/history/${id}`);
      setHistory(history.filter((item) => item._id !== id));
    } catch (err) {
      setError(err.response?.data?.error || "Delete failed.");
    }
  }

  function loadSavedStudy(item) {
    setSummary(item.summary || "");
    setQuiz(item.quiz || []);
    setFlashcards(item.flashcards || []);
    setAnswer("");
    setSelectedAnswers({});
    setFlippedCards({});
    setError("");
  }

  if (!token) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div>
            <p className="eyebrow">AI Study Assistant</p>
            <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
            <p className="auth-copy">
              Save private summaries, quizzes, and flashcards under your own account.
            </p>
          </div>

          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "signup" && (
              <label>
                Name
                <input
                  name="name"
                  value={authForm.name}
                  onChange={updateAuthForm}
                  placeholder="Your name"
                />
              </label>
            )}

            <label>
              Email
              <input
                name="email"
                type="email"
                value={authForm.email}
                onChange={updateAuthForm}
                placeholder="you@example.com"
              />
            </label>

            <label>
              Password
              <input
                name="password"
                type="password"
                value={authForm.password}
                onChange={updateAuthForm}
                placeholder="At least 6 characters"
              />
            </label>

            {authError && <p className="error-box">{authError}</p>}

            <button type="submit">
              {loading === "auth" ? "Please wait..." : authMode === "login" ? "Log In" : "Sign Up"}
            </button>
          </form>

          <button
            className="link-button"
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setAuthError("");
            }}
          >
            {authMode === "login"
              ? "Need an account? Sign up"
              : "Already have an account? Log in"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="user-card">
          <div>
            <p className="eyebrow">Signed in as</p>
            <h2>{user?.name}</h2>
            <p>{user?.email}</p>
          </div>
          <button className="ghost-button" onClick={logout}>Log Out</button>
        </div>

        <div className="history-heading">
          <h3>Saved Study Sets</h3>
          <span>{history.length}</span>
        </div>

        {history.length === 0 && <p className="muted">No saved study sets yet.</p>}

        {history.map((item) => (
          <div className="history-row" key={item._id}>
            <button className="history-item" onClick={() => loadSavedStudy(item)}>
              <strong>{item.fileName}</strong>
              <span>{new Date(item.createdAt).toLocaleDateString()}</span>
            </button>
            <button className="delete-button" onClick={() => deleteStudy(item._id)}>
              Delete
            </button>
          </div>
        ))}
      </aside>

      <main className="container">
        <div className="page-header">
          <div>
            <p className="eyebrow">Study workspace</p>
            <h1>AI Study Assistant</h1>
          </div>
          <button className="secondary-button" onClick={clearStudy}>New Study</button>
        </div>

        <div className="upload-box">
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setPdf(event.target.files[0])}
          />
          {pdf && <p className="file-name">{pdf.name}</p>}
        </div>

        <div className="buttons">
          <button onClick={() => sendRequest("summarize")}>
            {loading === "summarize" ? "Summarizing..." : "Summarize Notes"}
          </button>
          <button onClick={() => sendRequest("quiz")}>
            {loading === "quiz" ? "Generating..." : "Generate Quiz"}
          </button>
          <button onClick={() => sendRequest("flashcards")}>
            {loading === "flashcards" ? "Creating..." : "Make Flashcards"}
          </button>
          <button className="save-button" onClick={saveStudy}>
            {loading === "save" ? "Saving..." : "Save Study Set"}
          </button>
        </div>

        <div className="ask-box">
          <input
            type="text"
            placeholder="Ask a question from the PDF"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button onClick={() => sendRequest("ask")}>
            {loading === "ask" ? "Asking..." : "Ask"}
          </button>
        </div>

        {error && <p className={error.includes("failed") || error.includes("wrong") ? "error-box" : "status-box"}>{error}</p>}

        <div className="results-board">
          {answer && (
          <section className="section output-section">
            <div className="section-title-row answer-title">
              <div>
                <p className="section-kicker">Question response</p>
                <h2>Answer</h2>
              </div>
            </div>
            <div className="text-result">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
          </section>
        )}

        {summary && (
          <section className="section output-section">
            <div className="section-header summary-title">
              <div>
                <p className="section-kicker">Study notes</p>
                <h2>Summary</h2>
              </div>
              <div className="summary-actions">
                <button onClick={copySummary}>Copy</button>
                <button onClick={downloadSummary}>Download</button>
              </div>
            </div>
            <div className="text-result">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
          </section>
        )}

        {quiz.length > 0 && (
          <section className="section output-section">
            <div className="section-title-row quiz-title">
              <div>
                <p className="section-kicker">Practice mode</p>
                <h2>Quiz</h2>
              </div>
              <span className="count-pill">{quiz.length} questions</span>
            </div>
            <div className="score-panel">
              <div>
                <p className="score-label">Score</p>
                <strong>{correctCount}/{quiz.length}</strong>
              </div>
              <div>
                <p className="score-label">Answered</p>
                <strong>{answeredCount}/{quiz.length}</strong>
              </div>
              <div>
                <p className="score-label">Accuracy</p>
                <strong>{quizScore}%</strong>
              </div>
            </div>
            <div className="quiz-list">
              {quiz.map((item, index) => (
                <div className="quiz-card" key={index}>
                  <h3>
                    {index + 1}. {item.question}
                  </h3>
                  {item.options.map((option) => {
                    const selected = selectedAnswers[index];
                    const isCorrect = option === item.answer;
                    const className = [
                      "option",
                      selected === option && isCorrect ? "correct-answer" : "",
                      selected === option && !isCorrect ? "wrong-answer" : "",
                    ].join(" ");

                    return (
                      <button
                        key={option}
                        className={className}
                        onClick={() =>
                          setSelectedAnswers({
                            ...selectedAnswers,
                            [index]: option,
                          })
                        }
                      >
                        {option}
                      </button>
                    );
                  })}
                  {selectedAnswers[index] && (
                    <p className="explanation">
                      Correct answer: <strong>{item.answer}</strong>. {item.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {flashcards.length > 0 && (
          <section className="section output-section">
            <div className="section-title-row flashcards-title">
              <div>
                <p className="section-kicker">Review deck</p>
                <h2>Flashcards</h2>
              </div>
              <span className="count-pill">{flashcards.length} cards</span>
            </div>
            <div className="flashcard-grid">
              {flashcards.map((card, index) => (
                <div
                  className={`flashcard ${flippedCards[index] ? "flipped" : ""}`}
                  key={index}
                  onClick={() =>
                    setFlippedCards({
                      ...flippedCards,
                      [index]: !flippedCards[index],
                    })
                  }
                >
                  <div className="flashcard-inner">
                    <div className="flashcard-front">{card.front}</div>
                    <div className="flashcard-back">{card.back}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        </div>
      </main>
    </div>
  );
}

export default App;
