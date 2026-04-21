import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.jsx"),
  route("editor",          "./routes/editor.jsx"),
  route("history",         "./routes/history.jsx"),
  route("visualizer/:id", "./routes/visualizer.$id.jsx"),
  route("login",           "./routes/login.jsx"),
  route("signup",          "./routes/signup.jsx"),
];
