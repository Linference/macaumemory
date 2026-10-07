export function escapeMemoryText(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function memoryDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value ?? "");
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "日期未記錄";
}

export function memorySourceLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? escapeMemoryText(url.href) : "";
  } catch { return ""; }
}
