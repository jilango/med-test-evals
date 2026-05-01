import { z } from "zod";

export const VitalSignsSchema = z.object({
  bp: z.string().regex(/^[0-9]{2,3}\/[0-9]{2,3}$/).nullable(),
  hr: z.number().int().min(20).max(250).nullable(),
  temp_f: z.number().min(90).max(110).nullable(),
  spo2: z.number().int().min(50).max(100).nullable(),
});

export const MedicationSchema = z.object({
  name: z.string().min(1),
  dose: z.string().min(1).nullable(),
  frequency: z.string().min(1).nullable(),
  route: z.string().min(1).nullable(),
});

export const DiagnosisSchema = z.object({
  description: z.string().min(1),
  icd10: z.string().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/).optional(),
});

export const FollowUpSchema = z.object({
  interval_days: z.number().int().min(0).max(730).nullable(),
  reason: z.string().min(1).nullable(),
});

export const ClinicalExtractionSchema = z.object({
  chief_complaint: z.string().min(1),
  vitals: VitalSignsSchema,
  medications: z.array(MedicationSchema),
  diagnoses: z.array(DiagnosisSchema),
  plan: z.array(z.string().min(1)),
  follow_up: FollowUpSchema,
});

export type VitalSigns = z.infer<typeof VitalSignsSchema>;
export type Medication = z.infer<typeof MedicationSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type FollowUp = z.infer<typeof FollowUpSchema>;
export type ClinicalExtraction = z.infer<typeof ClinicalExtractionSchema>;

