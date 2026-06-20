import { api } from './client.js';

export interface ExamBoard {
  examBoardId:    string;
  boardTypeCode:  string;
  academicYear:   string;
  academicPeriodId: string | null;
  periodCode:       string | null;
  meetingDate:    string | null;
  ratifiedAt:     string | null;
  deferredAt:     string | null;
  deferralReason: string | null;
  quorumCount:    number | null;
  quorumRecordedAt: string | null;
  actorId:        string;
  createdAt:      string;
}

export interface ExamBoardDataPack {
  dataPackId:           string;
  examBoardId:          string;
  packVersion:          number;
  supersededById:       string | null;
  sourceTransactionTime: string;
  candidateCount:       number;
  generatedAt:          string;
  generatedBy:          string;
}

export interface ExamEntry {
  examEntryId:          string;
  moduleRegistrationId: string;
  examBoardId:          string;
  candidateNumber:      string;
  scheduledDate:        string | null;
  roomReference:        string | null;
  statusCode:           string;
  accommodations:       string[];
  validFrom:            string;
  recordedAt:           string;
}

export interface CandidateProfile {
  candidateProfileId: string;
  dataPackId:         string;
  enrolmentId:        string;
  personId:           string;
  profileData:        Record<string, unknown>;
  createdAt:          string;
}

export function listExamBoards(params?: {
  academicYear?: string;
  boardTypeCode?: string;
}): Promise<ExamBoard[]> {
  const qs = new URLSearchParams();
  if (params?.academicYear)  qs.set('academicYear',  params.academicYear);
  if (params?.boardTypeCode) qs.set('boardTypeCode', params.boardTypeCode);
  const query = qs.toString();
  return api.get<ExamBoard[]>(`/api/v1/exam-boards${query ? `?${query}` : ''}`);
}

export function createExamBoard(body: {
  boardTypeCode:    string;
  academicYear:     string;
  academicPeriodId?: string;
  meetingDate?:     string;
}): Promise<{ examBoardId: string }> {
  return api.post('/api/v1/exam-boards', body);
}

export function getExamBoard(boardId: string): Promise<ExamBoard> {
  return api.get<ExamBoard>(`/api/v1/exam-boards/${boardId}`);
}

export function generateDataPack(boardId: string): Promise<{ dataPackId: string }> {
  return api.post(`/api/v1/exam-boards/${boardId}/data-pack`, {});
}

export function getDataPack(boardId: string): Promise<ExamBoardDataPack> {
  return api.get<ExamBoardDataPack>(`/api/v1/exam-boards/${boardId}/data-pack`);
}

export function generateExamEntries(boardId: string): Promise<void> {
  return api.post(`/api/v1/exam-boards/${boardId}/exam-entries/generate`, {});
}

export function listExamEntries(boardId: string): Promise<ExamEntry[]> {
  return api.get<ExamEntry[]>(`/api/v1/exam-boards/${boardId}/exam-entries`);
}

export function getCandidateProfile(boardId: string, enrolmentId: string): Promise<CandidateProfile> {
  return api.get<CandidateProfile>(`/api/v1/exam-boards/${boardId}/candidates/${enrolmentId}`);
}

export function signOffExternalExaminer(
  boardId:     string,
  commentary?: string,
): Promise<{ signoffId: string }> {
  return api.post(`/api/v1/exam-boards/${boardId}/external-examiner-signoff`, { commentary });
}

export function ratifyExamBoard(boardId: string): Promise<void> {
  return api.post(`/api/v1/exam-boards/${boardId}/ratification`, {});
}
