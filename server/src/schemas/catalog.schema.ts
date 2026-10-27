import { z } from "zod";

// Product ids are UUIDs; anything else is answered as an unknown product
export const catalogProductIdSchema = z.guid();
