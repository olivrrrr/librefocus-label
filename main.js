/*
Copyright (C) 2024 <https://github.com/leveled-up>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const $ = document.querySelector.bind(document);

const idleTitle = document.title;
const startBtn = $(".toggle>button");
const timer = $(".timer");
const progress = $(".progress");
const counter = $(".counter");
const stepText = $(".step-text");
const stepBtns = [...document.querySelectorAll(".steps>button")];
const labelInput = $(".task-label");
const sessionsBody = $(".session-table-body");
const totalTimeElem = $(".total-time");
const clearHistoryBtn = $(".clear-history");
const exportCsvBtn = $(".export-csv");
const statList = $(".stat-list");
const averageTimeElem = $(".average-time");
const sortableHeaders = [...document.querySelectorAll("th.sortable")];

const steps = [
    { name: "focus", dur: 25 * 60 * 1000, text: "Time to focus!" },
    { name: "shortbreak", dur: 5 * 60 * 1000, text: "Time for a break!" },
    { name: "longbreak", dur: 15 * 60 * 1000, text: "Time for a break!" }
];
const ringUrl = "ring.mp3";

const SESSION_STORAGE_KEY = "librefocusSessions";
const LABEL_STORAGE_KEY = "librefocusLastLabel";

const safeGet = key => {
    try { return localStorage.getItem(key); } catch (err) { return null; }
};
const safeSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch (err) { }
};

let currentStep = 0;
let count = 1;
let timeLeft = steps[0].dur;
let startTime = null;
let timeout = null;
let refreshInterval = null;
let activeTaskLabel = safeGet(LABEL_STORAGE_KEY) || "General";
let sessionsLog = [];
let sortState = { key: "finished", dir: "desc" };

if (labelInput) labelInput.value = activeTaskLabel;

const formatDuration = seconds => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}m ${sec}s`;
};

const formatDate = ms => {
    try { return new Date(ms).toLocaleString(); } catch (err) { return "-"; }
};

const computeStats = () => {
    const labelMap = {};
    let totalSec = 0;
    sessionsLog.forEach(session => {
        totalSec += session.duration;
        labelMap[session.label] = (labelMap[session.label] || 0) + session.duration;
    });
    const stats = Object.entries(labelMap)
        .map(([label, duration]) => ({ label, duration }))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3);
    const average = sessionsLog.length ? Math.round(totalSec / sessionsLog.length) : 0;
    return { stats, average };
};

const renderStats = () => {
    if (!statList || !averageTimeElem) return;
    const { stats, average } = computeStats();
    statList.innerHTML = "";
    stats.forEach(entry => {
        const li = document.createElement("li");
        const labelSpan = document.createElement("span");
        const durationSpan = document.createElement("span");
        labelSpan.innerText = entry.label;
        durationSpan.innerText = formatDuration(entry.duration);
        li.appendChild(labelSpan);
        li.appendChild(durationSpan);
        statList.appendChild(li);
    });
    if (!stats.length) {
        const li = document.createElement("li");
        li.innerText = "No sessions yet";
        statList.appendChild(li);
    }
    averageTimeElem.innerText = `${Math.round(average / 60)}m`;
};

const renderSessions = () => {
    if (!sessionsBody || !totalTimeElem) return;
    let totalSeconds = 0;
    sessionsBody.innerHTML = "";
    const sorted = [...sessionsLog];
    sorted.sort((a, b) => {
        const order = sortState.dir === "asc" ? 1 : -1;
        if (sortState.key === "duration") return (a.duration - b.duration) * order;
        if (sortState.key === "label") return a.label.localeCompare(b.label) * order;
        return (a.finishedAt - b.finishedAt) * order;
    });
    sorted.forEach(session => {
        const row = document.createElement("tr");
        const label = document.createElement("td");
        const duration = document.createElement("td");
        const finished = document.createElement("td");
        label.innerText = session.label;
        duration.innerText = formatDuration(session.duration);
        finished.innerText = formatDate(session.finishedAt);
        row.appendChild(label);
        row.appendChild(duration);
        row.appendChild(finished);
        sessionsBody.appendChild(row);
        totalSeconds += session.duration;
    });
    totalTimeElem.innerText = `${Math.round(totalSeconds / 60)}m`;
    renderStats();
};

const persistSessions = () => safeSet(SESSION_STORAGE_KEY, JSON.stringify(sessionsLog));

const loadSessions = () => {
    const stored = safeGet(SESSION_STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) sessionsLog = parsed;
        } catch (err) {
            sessionsLog = [];
        }
    }
    renderSessions();
};

const addSessionRecord = record => {
    sessionsLog = [record, ...sessionsLog];
    if (sessionsLog.length > 200) sessionsLog.pop();
    persistSessions();
    renderSessions();
};

const clearSessionHistory = () => {
    if (confirm("Clear all logged focus sessions?")) {
        sessionsLog = [];
        persistSessions();
        renderSessions();
    }
};

const exportCsv = () => {
    if (!sessionsLog.length) return;
    const rows = ["Label,DurationSeconds,FinishedAt"].concat(sessionsLog.map(s =>
        `${s.label.replace(/"/g, '""')},${s.duration},${new Date(s.finishedAt).toISOString()}`
    ));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "librefocus-sessions.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const logFocusSession = durationMs => {
    const durationSec = Math.round(durationMs / 1000);
    if (durationSec <= 0) return;
    addSessionRecord({
        label: activeTaskLabel,
        duration: durationSec,
        finishedAt: new Date().valueOf()
    });
};

const updateLabelStorage = () => {
    if (labelInput) {
        const labelValue = labelInput.value.trim();
        activeTaskLabel = labelValue || activeTaskLabel || "General";
        labelInput.value = activeTaskLabel;
        safeSet(LABEL_STORAGE_KEY, activeTaskLabel);
    }
};

const start = () => {
    updateLabelStorage();
    startTime = new Date().valueOf();
    refreshInterval = setInterval(tick, 1000);
    timeout = setTimeout(end, timeLeft);
    startBtn.onclick = pause;
    startBtn.innerText = "PAUSE";
    startBtn.classList.remove("idle");
    tick();
};

const pause = () => {
    clearInterval(refreshInterval);
    clearTimeout(timeout);
    refreshInterval = null;
    timeout = 0;
    const alreadyPassed = (new Date().valueOf() - startTime);
    timeLeft -= alreadyPassed;
    startTime = null;
    startBtn.onclick = start;
    startBtn.innerText = "START";
    startBtn.classList.add("idle");
    document.title = idleTitle;
};

const tick = () => {
    let alreadyPassed = 0;
    if (startTime)
        alreadyPassed = (new Date().valueOf() - startTime);
    let _timeLeft = (timeLeft - alreadyPassed);
    let percent = 100 - (_timeLeft / steps[currentStep].dur) * 100;
    progress.style.width = percent.toString() + "%";
    _timeLeft = Math.max(0, Math.round(_timeLeft / 1000));
    let sec = _timeLeft % 60;
    let min = Math.floor(_timeLeft / 60);
    const toStr = n => n.toString().split(".")[0].padStart(2, "0");
    const str = toStr(min) + ":" + toStr(sec);
    timer.innerText = str;
    if (startTime) document.title = str + " - " + steps[currentStep].text;
};

const end = () => {
    if (currentStep === 0 && startTime) {
        const durationMs = new Date().valueOf() - startTime;
        logFocusSession(durationMs);
    }
    try {
        const audio = new Audio(ringUrl);
        audio.play();
    } catch (err) {
        console.debug(err);
    }
    startTime = null;
    if (currentStep == 0)
        currentStep = (count % 4 == 0) ? 2 : 1;
    else {
        currentStep = 0;
        count += 1;
    }
    const stepProp = steps[currentStep];
    document.body.className = stepProp.name;
    counter.innerText = "#" + count.toString();
    stepText.innerText = stepProp.text;
    timeLeft = stepProp.dur;
    startBtn.onclick = start;
    startBtn.innerText = "START";
    startBtn.classList.add("idle");
    document.title = idleTitle;
    for (const btn of stepBtns)
        btn.className = "";
    stepBtns[currentStep].className = "active";
    tick();
};

startBtn.onclick = start;
startBtn.addEventListener("keydown", event => event.preventDefault());
document.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ")
        startBtn.dispatchEvent(new Event("click"));
});
if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", clearSessionHistory);
if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportCsv);
if (labelInput) labelInput.addEventListener("blur", updateLabelStorage);

const toggleSort = key => {
    if (sortState.key === key)
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    else {
        sortState.key = key;
        sortState.dir = "desc";
    }
    sortableHeaders.forEach(th => {
        th.classList.remove("sorted-asc", "sorted-desc");
        if (th.dataset.sort === sortState.key)
            th.classList.add(sortState.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
    renderSessions();
};

sortableHeaders.forEach(header => {
    header.addEventListener("click", () => toggleSort(header.dataset.sort));
});

loadSessions();
