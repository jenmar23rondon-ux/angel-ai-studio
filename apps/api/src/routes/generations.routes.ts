import { Router } from "express";
import { createGeneration, listGenerations } from "../controllers/generations.controller.js";

export const generationsRouter = Router();

generationsRouter.get("/", listGenerations);
generationsRouter.post("/", createGeneration);
