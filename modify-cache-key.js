var knownOptionKeys = {
  quality: "100",
  w: "",
  h: "",
  format: "",
};
var knownExtensions = {
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
  gif: "gif",
  avif: "avif",
};

function getExtension(extension) {
  if (typeof extension !== "string") return;
  extension = extension.toLowerCase();

  return knownExtensions[extension];
}

function handler(event) {
  if (event.request.method !== "GET") return event.request;

  var extension = getExtension(event.request.uri.split(".").pop());
  var request = event.request;
  var parts = [];

  Object.keys(knownOptionKeys).forEach((key) => {
    var defaultVal = key === "format" ? extension : knownOptionKeys[key];
    var valueExists = typeof event.request.querystring[key] !== "undefined";
    var value;

    if (valueExists) {
      value =
        key === "format"
          ? getExtension(event.request.querystring[key].value)
          : event.request.querystring[key].value;
    }

    parts.push(key + "(" + (value || defaultVal) + ")");
  });

  request.uri = request.uri + "/" + parts.join("");

  return request;
}
