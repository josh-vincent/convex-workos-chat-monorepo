import { defineSchema } from "convex/server";

// The chat starter is stateless — useChat keeps messages client-side and the
// /chat HTTP action streams responses. Add tables here to persist threads.
export default defineSchema({});
