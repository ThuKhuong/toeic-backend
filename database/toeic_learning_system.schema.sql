--
-- PostgreSQL database dump
--

\restrict 1JJbb0DLw5YT0FGc4Z7zlFYAKFLH7hCDm21aZafXPmOXkwjMycz8IXWUaXQRctB

-- Dumped from database version 15.12
-- Dumped by pg_dump version 17.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: learning_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.learning_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Learning evidence is append-only'; END $$;


--
-- Name: learning_capture_answer_revision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.learning_capture_answer_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE snap JSONB; owner_id INTEGER;
BEGIN
 IF TG_OP='INSERT' AND NEW.user_answer IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.user_answer IS NOT DISTINCT FROM NEW.user_answer THEN RETURN NEW; END IF;
 SELECT aq.question_snapshot,a.user_id INTO snap,owner_id FROM attempt_questions aq
 JOIN user_test_attempts a USING(attempt_id) WHERE aq.attempt_id=NEW.attempt_id AND aq.question_id=NEW.question_id;
 INSERT INTO learning_answer_revisions(user_id,attempt_id,question_id,previous_answer,new_answer,correctness,question_version,baseline_known)
 VALUES(owner_id,NEW.attempt_id,NEW.question_id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.user_answer END,
 NEW.user_answer,CASE WHEN NEW.user_answer IS NULL THEN NULL ELSE NEW.user_answer=snap->>'correct_answer' END,
 snap->'learning_version'->>'question_version',TG_OP='INSERT' OR
 (OLD.user_answer IS NULL AND snap ? 'learning_version' AND NOT EXISTS(SELECT 1 FROM learning_answer_revisions
  WHERE attempt_id=NEW.attempt_id AND question_id=NEW.question_id)));
 RETURN NEW;
END $$;


--
-- Name: learning_protect_mapping(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.learning_protect_mapping() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mapping provenance must be retained'; END IF;
 IF OLD.review_status='rejected' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  RAISE EXCEPTION 'Revoked mapping is immutable; create a new version';
 END IF;
 IF OLD.review_status='approved' AND ((to_jsonb(NEW)-'review_status') IS DISTINCT FROM (to_jsonb(OLD)-'review_status') OR NEW.review_status NOT IN ('approved','rejected')) THEN
  RAISE EXCEPTION 'Approved mapping content is immutable; create a new version';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: sync_test_publication(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_test_publication() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.publication_status := COALESCE(NEW.publication_status,CASE WHEN NEW.is_active THEN 'published' ELSE 'draft' END);
  ELSIF NEW.publication_status IS NOT DISTINCT FROM OLD.publication_status AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.publication_status := CASE WHEN NEW.is_active THEN 'published' ELSE 'draft' END;
  END IF;
  IF NEW.publication_status IS NULL OR NEW.publication_status NOT IN ('draft','published','unpublished') THEN
    RAISE EXCEPTION 'Invalid publication status' USING ERRCODE='23514';
  END IF;
  NEW.is_active := NEW.publication_status='published';
  RETURN NEW;
END $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    user_id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(255),
    avatar_url text,
    role character varying(20) DEFAULT 'STUDENT'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_role_check" CHECK (((role)::text = ANY ((ARRAY['STUDENT'::character varying, 'TEACHER'::character varying, 'ADMIN'::character varying])::text[])))
);


--
-- Name: User_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."User_user_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: User_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."User_user_id_seq" OWNED BY public."User".user_id;


--
-- Name: ai_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_assessments (
    assessment_id bigint NOT NULL,
    user_id integer NOT NULL,
    trigger_attempt_id integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    model_provider character varying(100) NOT NULL,
    model_name character varying(150) NOT NULL,
    model_version character varying(150) NOT NULL,
    prompt_version character varying(100) NOT NULL,
    feature_version character varying(100) NOT NULL,
    input_snapshot jsonb NOT NULL,
    output_payload jsonb,
    summary text,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ai_assessments_check CHECK ((completed_at >= started_at)),
    CONSTRAINT ai_assessments_check1 CHECK ((((status)::text <> 'completed'::text) OR ((completed_at IS NOT NULL) AND (output_payload IS NOT NULL)))),
    CONSTRAINT ai_assessments_check2 CHECK ((((status)::text <> 'failed'::text) OR (error_message IS NOT NULL))),
    CONSTRAINT ai_assessments_input_snapshot_check CHECK ((jsonb_typeof(input_snapshot) = 'object'::text)),
    CONSTRAINT ai_assessments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: ai_assessments_assessment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_assessments_assessment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_assessments_assessment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_assessments_assessment_id_seq OWNED BY public.ai_assessments.assessment_id;


--
-- Name: answer_choices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answer_choices (
    choice_id integer NOT NULL,
    question_id integer NOT NULL,
    choice_text text NOT NULL,
    choice_label character(1) NOT NULL,
    is_correct boolean DEFAULT false,
    CONSTRAINT answer_choices_choice_label_check CHECK ((choice_label = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))
);


--
-- Name: answer_choices_choice_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.answer_choices_choice_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: answer_choices_choice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.answer_choices_choice_id_seq OWNED BY public.answer_choices.choice_id;


--
-- Name: assessment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_attempts (
    assessment_id bigint NOT NULL,
    attempt_id integer NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: assessment_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_recommendations (
    recommendation_id bigint NOT NULL,
    assessment_id bigint NOT NULL,
    skill_id integer NOT NULL,
    test_id integer,
    priority integer DEFAULT 1 NOT NULL,
    reason text NOT NULL,
    instructions text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT assessment_recommendations_priority_check CHECK (((priority >= 1) AND (priority <= 5)))
);


--
-- Name: assessment_recommendations_recommendation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assessment_recommendations_recommendation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assessment_recommendations_recommendation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assessment_recommendations_recommendation_id_seq OWNED BY public.assessment_recommendations.recommendation_id;


--
-- Name: assessment_score_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_score_predictions (
    assessment_id bigint NOT NULL,
    listening_score integer,
    reading_score integer,
    total_score integer GENERATED ALWAYS AS ((listening_score + reading_score)) STORED,
    confidence numeric(5,4),
    method_version character varying(150) NOT NULL,
    explanation text,
    CONSTRAINT assessment_score_predictions_check CHECK (((listening_score IS NOT NULL) OR (reading_score IS NOT NULL))),
    CONSTRAINT assessment_score_predictions_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT assessment_score_predictions_listening_score_check CHECK (((listening_score >= 5) AND (listening_score <= 495))),
    CONSTRAINT assessment_score_predictions_reading_score_check CHECK (((reading_score >= 5) AND (reading_score <= 495)))
);


--
-- Name: assessment_skill_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_skill_results (
    assessment_id bigint NOT NULL,
    skill_id integer NOT NULL,
    mastery_score numeric(5,2),
    confidence numeric(5,4),
    evidence_count integer NOT NULL,
    correct_count integer NOT NULL,
    average_response_seconds numeric(10,2),
    assessment_label character varying(30) NOT NULL,
    feedback text,
    CONSTRAINT assessment_skill_results_assessment_label_check CHECK (((assessment_label)::text = ANY ((ARRAY['insufficient_data'::character varying, 'needs_practice'::character varying, 'developing'::character varying, 'proficient'::character varying])::text[]))),
    CONSTRAINT assessment_skill_results_average_response_seconds_check CHECK ((average_response_seconds >= (0)::numeric)),
    CONSTRAINT assessment_skill_results_check CHECK (((correct_count >= 0) AND (correct_count <= evidence_count))),
    CONSTRAINT assessment_skill_results_check1 CHECK (((((assessment_label)::text = 'insufficient_data'::text) AND (mastery_score IS NULL)) OR (((assessment_label)::text <> 'insufficient_data'::text) AND (mastery_score IS NOT NULL) AND (evidence_count > 0)))),
    CONSTRAINT assessment_skill_results_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT assessment_skill_results_evidence_count_check CHECK ((evidence_count >= 0)),
    CONSTRAINT assessment_skill_results_mastery_score_check CHECK (((mastery_score >= (0)::numeric) AND (mastery_score <= (100)::numeric)))
);


--
-- Name: attempt_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attempt_questions (
    attempt_id integer NOT NULL,
    question_id integer NOT NULL,
    "position" integer NOT NULL,
    question_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT attempt_questions_position_check CHECK (("position" > 0)),
    CONSTRAINT attempt_questions_question_snapshot_check CHECK ((jsonb_typeof(question_snapshot) = 'object'::text))
);


--
-- Name: learning_answer_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_answer_observations (
    observation_id uuid NOT NULL,
    user_id integer NOT NULL,
    attempt_id integer NOT NULL,
    question_id integer NOT NULL,
    answer character(1) NOT NULL,
    correctness boolean NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    question_version text NOT NULL,
    question_fingerprint text NOT NULL,
    part_number integer NOT NULL,
    group_id integer,
    prior_response_count integer NOT NULL,
    is_first_response boolean NOT NULL,
    mapping_version uuid,
    taxonomy_version text,
    primary_kc text,
    secondary_kcs jsonb DEFAULT '[]'::jsonb NOT NULL,
    mapping_provenance jsonb,
    bkt_eligible_at_capture boolean DEFAULT false NOT NULL,
    exclusion_reason text
);


--
-- Name: learning_kc_mapping_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_kc_mapping_versions (
    mapping_version uuid NOT NULL,
    question_id integer NOT NULL,
    question_version text NOT NULL,
    taxonomy_version text NOT NULL,
    review_status text NOT NULL,
    primary_kc text NOT NULL,
    secondary_kcs jsonb DEFAULT '[]'::jsonb NOT NULL,
    content_verified boolean DEFAULT false NOT NULL,
    audio_verified boolean DEFAULT false NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    provenance jsonb NOT NULL,
    CONSTRAINT learning_kc_mapping_versions_check CHECK (((review_status <> 'approved'::text) OR ((COALESCE(length(TRIM(BOTH FROM reviewed_by)), 0) > 0) AND (reviewed_at IS NOT NULL) AND (provenance <> '{}'::jsonb)))),
    CONSTRAINT learning_kc_mapping_versions_provenance_check CHECK ((jsonb_typeof(provenance) = 'object'::text)),
    CONSTRAINT learning_kc_mapping_versions_review_status_check CHECK ((review_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT learning_kc_mapping_versions_secondary_kcs_check CHECK ((jsonb_typeof(secondary_kcs) = 'array'::text))
);


--
-- Name: bkt_ready_observations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bkt_ready_observations AS
 SELECT o.observation_id,
    o.user_id,
    o.attempt_id,
    o.question_id,
    o.answer,
    o.correctness,
    o.observed_at,
    o.question_version,
    o.question_fingerprint,
    o.part_number,
    o.group_id,
    o.prior_response_count,
    o.is_first_response,
    o.mapping_version,
    o.taxonomy_version,
    o.primary_kc,
    o.secondary_kcs,
    o.mapping_provenance,
    o.bkt_eligible_at_capture,
    o.exclusion_reason
   FROM (public.learning_answer_observations o
     JOIN public.learning_kc_mapping_versions m ON ((m.mapping_version = o.mapping_version)))
  WHERE (o.bkt_eligible_at_capture AND (m.review_status = 'approved'::text) AND m.content_verified AND ((o.part_number > 4) OR m.audio_verified) AND (o.question_version = m.question_version));


--
-- Name: database_consolidation_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.database_consolidation_rows (
    migration_id uuid NOT NULL,
    origin_database text NOT NULL,
    table_name text NOT NULL,
    source_key jsonb NOT NULL,
    target_key jsonb NOT NULL,
    source_row_sha256 text NOT NULL,
    action text NOT NULL
);


--
-- Name: database_consolidations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.database_consolidations (
    migration_id uuid NOT NULL,
    migrated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    origin_database text NOT NULL,
    backup_manifest_sha256 text NOT NULL
);


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    batch_id bigint NOT NULL,
    kind character varying(20) NOT NULL,
    fingerprint character(64) NOT NULL,
    row_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT import_batches_kind_check CHECK (((kind)::text = ANY ((ARRAY['reading'::character varying, 'listening'::character varying, 'vocabulary'::character varying])::text[]))),
    CONSTRAINT import_batches_row_count_check CHECK ((row_count > 0))
);


--
-- Name: import_batches_batch_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_batches_batch_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_batches_batch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_batches_batch_id_seq OWNED BY public.import_batches.batch_id;


--
-- Name: latest_user_skill_assessments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_user_skill_assessments AS
 SELECT DISTINCT ON (a.user_id, r.skill_id) a.user_id,
    r.assessment_id,
    r.skill_id,
    r.mastery_score,
    r.confidence,
    r.evidence_count,
    r.correct_count,
    r.average_response_seconds,
    r.assessment_label,
    r.feedback,
    a.completed_at
   FROM (public.ai_assessments a
     JOIN public.assessment_skill_results r ON ((r.assessment_id = a.assessment_id)))
  WHERE ((a.status)::text = 'completed'::text)
  ORDER BY a.user_id, r.skill_id, a.completed_at DESC, a.assessment_id DESC;


--
-- Name: learning_answer_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_answer_revisions (
    revision_id bigint NOT NULL,
    user_id integer NOT NULL,
    attempt_id integer NOT NULL,
    question_id integer NOT NULL,
    previous_answer character(1),
    new_answer character(1),
    correctness boolean,
    changed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    question_version text,
    baseline_known boolean NOT NULL
);


--
-- Name: learning_answer_revisions_revision_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.learning_answer_revisions_revision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: learning_answer_revisions_revision_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.learning_answer_revisions_revision_id_seq OWNED BY public.learning_answer_revisions.revision_id;


--
-- Name: learning_attempt_sync; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_attempt_sync (
    attempt_id integer NOT NULL,
    revision bigint NOT NULL,
    payload_sha256 text NOT NULL,
    CONSTRAINT learning_attempt_sync_revision_check CHECK ((revision > 0))
);


--
-- Name: learning_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_events (
    event_id uuid NOT NULL,
    user_id integer NOT NULL,
    attempt_id integer,
    question_id integer,
    lesson_id text,
    event_type text NOT NULL,
    event_timestamp timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    event_payload jsonb NOT NULL,
    question_version text,
    taxonomy_version text,
    mapping_version uuid,
    mapping_provenance jsonb,
    client_session_id uuid,
    client_sequence bigint,
    client_event_sha256 text NOT NULL,
    source text NOT NULL,
    CONSTRAINT learning_events_check CHECK (((client_session_id IS NULL) = (client_sequence IS NULL))),
    CONSTRAINT learning_events_check1 CHECK ((((lesson_id IS NOT NULL) AND (attempt_id IS NULL) AND (question_id IS NULL) AND (event_type = ANY (ARRAY['LESSON_STARTED'::text, 'LESSON_COMPLETED'::text]))) OR ((lesson_id IS NULL) AND (attempt_id IS NOT NULL) AND (((event_type = 'ATTEMPT_COMPLETED'::text) AND (question_id IS NULL)) OR ((event_type = ANY (ARRAY['QUESTION_VIEWED'::text, 'ANSWER_SUBMITTED'::text, 'ANSWER_CHANGED'::text, 'AUDIO_PLAYED'::text, 'EXPLANATION_VIEWED'::text])) AND (question_id IS NOT NULL)))))),
    CONSTRAINT learning_events_client_sequence_check CHECK ((client_sequence > 0)),
    CONSTRAINT learning_events_event_payload_check CHECK ((jsonb_typeof(event_payload) = 'object'::text)),
    CONSTRAINT learning_events_event_type_check CHECK ((event_type = ANY (ARRAY['QUESTION_VIEWED'::text, 'ANSWER_SUBMITTED'::text, 'ANSWER_CHANGED'::text, 'AUDIO_PLAYED'::text, 'EXPLANATION_VIEWED'::text, 'ATTEMPT_COMPLETED'::text, 'LESSON_STARTED'::text, 'LESSON_COMPLETED'::text]))),
    CONSTRAINT learning_events_source_check CHECK ((source = ANY (ARRAY['client'::text, 'server'::text])))
);


--
-- Name: listening_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listening_materials (
    material_id integer NOT NULL,
    title character varying(500),
    audio_url text NOT NULL,
    transcript text,
    duration integer,
    difficulty_level integer DEFAULT 1,
    topic character varying(100),
    speaker_count integer DEFAULT 1,
    accent character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT listening_materials_difficulty_level_check CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5)))
);


--
-- Name: listening_materials_material_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listening_materials_material_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listening_materials_material_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listening_materials_material_id_seq OWNED BY public.listening_materials.material_id;


--
-- Name: question_group_passages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_group_passages (
    group_id integer NOT NULL,
    passage_id integer NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT question_group_passages_position_check CHECK (("position" > 0))
);


--
-- Name: question_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_groups (
    group_id integer NOT NULL,
    title character varying(500),
    part_number integer NOT NULL,
    material_id integer,
    image_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT question_groups_part_number_check CHECK (((part_number >= 1) AND (part_number <= 7)))
);


--
-- Name: question_groups_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.question_groups_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: question_groups_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.question_groups_group_id_seq OWNED BY public.question_groups.group_id;


--
-- Name: question_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_skills (
    question_id integer NOT NULL,
    skill_id integer NOT NULL,
    weight numeric(5,4) DEFAULT 1 NOT NULL,
    CONSTRAINT question_skills_weight_check CHECK (((weight > (0)::numeric) AND (weight <= (1)::numeric)))
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    question_id integer NOT NULL,
    test_id integer,
    question_text text,
    question_type character varying(50) NOT NULL,
    part_number integer,
    passage_id integer,
    material_id integer,
    vocab_id integer,
    audio_url text,
    image_url text,
    correct_answer character(1) NOT NULL,
    explanation text,
    difficulty_level integer DEFAULT 1,
    order_in_test integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    group_id integer,
    source_set text,
    source_question_number integer,
    CONSTRAINT questions_correct_answer_check CHECK ((correct_answer = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar]))),
    CONSTRAINT questions_difficulty_level_check CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5))),
    CONSTRAINT questions_order_in_test_check CHECK ((order_in_test > 0)),
    CONSTRAINT questions_part_number_check CHECK (((part_number >= 1) AND (part_number <= 7))),
    CONSTRAINT questions_question_type_check CHECK (((question_type)::text = ANY ((ARRAY['listening'::character varying, 'reading'::character varying, 'vocabulary'::character varying, 'grammar'::character varying])::text[])))
);


--
-- Name: questions_question_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.questions_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: questions_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.questions_question_id_seq OWNED BY public.questions.question_id;


--
-- Name: reading_passages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reading_passages (
    passage_id integer NOT NULL,
    title character varying(500),
    content text NOT NULL,
    image_url text,
    source character varying(255),
    difficulty_level integer DEFAULT 1,
    topic character varying(100),
    word_count integer,
    estimated_time integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    translation text,
    explanation text,
    CONSTRAINT reading_passages_difficulty_level_check CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5)))
);


--
-- Name: reading_passages_passage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reading_passages_passage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reading_passages_passage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reading_passages_passage_id_seq OWNED BY public.reading_passages.passage_id;


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    skill_id integer NOT NULL,
    code character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    section character varying(20) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT skills_section_check CHECK (((section)::text = ANY ((ARRAY['listening'::character varying, 'reading'::character varying])::text[])))
);


--
-- Name: skills_skill_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skills_skill_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skills_skill_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skills_skill_id_seq OWNED BY public.skills.skill_id;


--
-- Name: tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tests (
    test_id integer NOT NULL,
    test_name character varying(500) NOT NULL,
    test_type character varying(50) DEFAULT 'practice'::character varying,
    description text,
    total_questions integer DEFAULT 0,
    time_limit integer,
    difficulty_level integer DEFAULT 1,
    parts integer[],
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    publication_status character varying(20) NOT NULL,
    deleted_at timestamp without time zone,
    CONSTRAINT tests_difficulty_level_check CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5))),
    CONSTRAINT tests_parts_check CHECK ((parts <@ ARRAY[1, 2, 3, 4, 5, 6, 7])),
    CONSTRAINT tests_test_type_check CHECK (((test_type)::text = ANY ((ARRAY['full_test'::character varying, 'part_test'::character varying, 'practice'::character varying, 'mini_test'::character varying])::text[]))),
    CONSTRAINT tests_time_limit_check CHECK ((time_limit > 0)),
    CONSTRAINT tests_total_questions_check CHECK ((total_questions >= 0))
);


--
-- Name: tests_test_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tests_test_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tests_test_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tests_test_id_seq OWNED BY public.tests.test_id;


--
-- Name: user_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_answers (
    answer_id integer NOT NULL,
    attempt_id integer NOT NULL,
    question_id integer NOT NULL,
    user_answer character(1),
    is_correct boolean,
    time_spent integer,
    marked_for_review boolean DEFAULT false,
    answered_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_answers_time_spent_check CHECK ((time_spent >= 0)),
    CONSTRAINT user_answers_user_answer_check CHECK ((user_answer = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))
);


--
-- Name: user_answers_answer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_answers_answer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_answers_answer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_answers_answer_id_seq OWNED BY public.user_answers.answer_id;


--
-- Name: user_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_stats (
    stat_id integer NOT NULL,
    user_id integer NOT NULL,
    total_study_time integer DEFAULT 0,
    vocabulary_learned integer DEFAULT 0,
    tests_completed integer DEFAULT 0,
    correct_answers integer DEFAULT 0,
    total_answers integer DEFAULT 0,
    last_study_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_stats_check CHECK (((total_study_time >= 0) AND (tests_completed >= 0))),
    CONSTRAINT user_stats_check1 CHECK (((correct_answers >= 0) AND (total_answers >= correct_answers)))
);


--
-- Name: user_stats_stat_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_stats_stat_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_stats_stat_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_stats_stat_id_seq OWNED BY public.user_stats.stat_id;


--
-- Name: user_test_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_test_attempts (
    attempt_id integer NOT NULL,
    user_id integer NOT NULL,
    test_id integer NOT NULL,
    start_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    end_time timestamp without time zone,
    total_correct integer DEFAULT 0,
    total_questions integer DEFAULT 0,
    score integer,
    time_spent integer,
    is_completed boolean DEFAULT false NOT NULL,
    elapsed_seconds integer DEFAULT 0 NOT NULL,
    current_index integer DEFAULT 0 NOT NULL,
    duration_seconds integer,
    deadline_at timestamp with time zone,
    grading_result jsonb,
    ai_prediction jsonb,
    question_predictions jsonb,
    CONSTRAINT user_test_attempts_check CHECK (((total_questions >= 0) AND ((total_correct >= 0) AND (total_correct <= total_questions)))),
    CONSTRAINT user_test_attempts_check1 CHECK ((end_time >= start_time)),
    CONSTRAINT user_test_attempts_check2 CHECK (((NOT is_completed) OR (end_time IS NOT NULL))),
    CONSTRAINT user_test_attempts_time_spent_check CHECK ((time_spent >= 0))
);


--
-- Name: user_test_attempts_attempt_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_test_attempts_attempt_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_test_attempts_attempt_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_test_attempts_attempt_id_seq OWNED BY public.user_test_attempts.attempt_id;


--
-- Name: user_vocabulary_learning; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_vocabulary_learning (
    user_id integer NOT NULL,
    vocab_id integer NOT NULL,
    saved boolean DEFAULT false NOT NULL,
    status character varying(16) DEFAULT 'new'::character varying NOT NULL,
    needs_review boolean DEFAULT false NOT NULL,
    learned_at timestamp with time zone,
    last_studied_at timestamp with time zone,
    wrong_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT user_vocabulary_learning_status_check CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'learning'::character varying, 'known'::character varying])::text[]))),
    CONSTRAINT user_vocabulary_learning_wrong_count_check CHECK ((wrong_count >= 0))
);


--
-- Name: vocabulary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary (
    vocab_id integer NOT NULL,
    word character varying(255) NOT NULL,
    pronunciation character varying(255),
    meaning_vi text NOT NULL,
    meaning_en text,
    part_of_speech character varying(50),
    example_sentence text,
    example_translation text,
    audio_url text,
    image_url text,
    difficulty_level integer DEFAULT 1,
    frequency_score integer DEFAULT 1,
    topic_id integer,
    tags text[],
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    owner_user_id integer,
    CONSTRAINT vocabulary_difficulty_level_check CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5)))
);


--
-- Name: vocabulary_quiz_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_quiz_sessions (
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    questions jsonb NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    is_personal boolean DEFAULT true NOT NULL
);


--
-- Name: vocabulary_quiz_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_quiz_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_quiz_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_quiz_sessions_session_id_seq OWNED BY public.vocabulary_quiz_sessions.session_id;


--
-- Name: vocabulary_study_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_study_sessions (
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    scope_key text NOT NULL,
    word_ids integer[] NOT NULL,
    reviewed_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    known_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: vocabulary_study_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_study_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_study_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_study_sessions_session_id_seq OWNED BY public.vocabulary_study_sessions.session_id;


--
-- Name: vocabulary_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_topics (
    topic_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    owner_user_id integer
);


--
-- Name: vocabulary_topics_topic_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_topics_topic_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_topics_topic_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_topics_topic_id_seq OWNED BY public.vocabulary_topics.topic_id;


--
-- Name: vocabulary_vocab_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_vocab_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_vocab_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_vocab_id_seq OWNED BY public.vocabulary.vocab_id;


--
-- Name: User user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User" ALTER COLUMN user_id SET DEFAULT nextval('public."User_user_id_seq"'::regclass);


--
-- Name: ai_assessments assessment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assessments ALTER COLUMN assessment_id SET DEFAULT nextval('public.ai_assessments_assessment_id_seq'::regclass);


--
-- Name: answer_choices choice_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answer_choices ALTER COLUMN choice_id SET DEFAULT nextval('public.answer_choices_choice_id_seq'::regclass);


--
-- Name: assessment_recommendations recommendation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_recommendations ALTER COLUMN recommendation_id SET DEFAULT nextval('public.assessment_recommendations_recommendation_id_seq'::regclass);


--
-- Name: import_batches batch_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches ALTER COLUMN batch_id SET DEFAULT nextval('public.import_batches_batch_id_seq'::regclass);


--
-- Name: learning_answer_revisions revision_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_revisions ALTER COLUMN revision_id SET DEFAULT nextval('public.learning_answer_revisions_revision_id_seq'::regclass);


--
-- Name: listening_materials material_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_materials ALTER COLUMN material_id SET DEFAULT nextval('public.listening_materials_material_id_seq'::regclass);


--
-- Name: question_groups group_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_groups ALTER COLUMN group_id SET DEFAULT nextval('public.question_groups_group_id_seq'::regclass);


--
-- Name: questions question_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions ALTER COLUMN question_id SET DEFAULT nextval('public.questions_question_id_seq'::regclass);


--
-- Name: reading_passages passage_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_passages ALTER COLUMN passage_id SET DEFAULT nextval('public.reading_passages_passage_id_seq'::regclass);


--
-- Name: skills skill_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills ALTER COLUMN skill_id SET DEFAULT nextval('public.skills_skill_id_seq'::regclass);


--
-- Name: tests test_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests ALTER COLUMN test_id SET DEFAULT nextval('public.tests_test_id_seq'::regclass);


--
-- Name: user_answers answer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_answers ALTER COLUMN answer_id SET DEFAULT nextval('public.user_answers_answer_id_seq'::regclass);


--
-- Name: user_stats stat_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats ALTER COLUMN stat_id SET DEFAULT nextval('public.user_stats_stat_id_seq'::regclass);


--
-- Name: user_test_attempts attempt_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_test_attempts ALTER COLUMN attempt_id SET DEFAULT nextval('public.user_test_attempts_attempt_id_seq'::regclass);


--
-- Name: vocabulary vocab_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary ALTER COLUMN vocab_id SET DEFAULT nextval('public.vocabulary_vocab_id_seq'::regclass);


--
-- Name: vocabulary_quiz_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_quiz_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.vocabulary_quiz_sessions_session_id_seq'::regclass);


--
-- Name: vocabulary_study_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_study_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.vocabulary_study_sessions_session_id_seq'::regclass);


--
-- Name: vocabulary_topics topic_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_topics ALTER COLUMN topic_id SET DEFAULT nextval('public.vocabulary_topics_topic_id_seq'::regclass);


--
-- Name: User User_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_email_key" UNIQUE (email);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (user_id);


--
-- Name: ai_assessments ai_assessments_assessment_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assessments
    ADD CONSTRAINT ai_assessments_assessment_id_user_id_key UNIQUE (assessment_id, user_id);


--
-- Name: ai_assessments ai_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assessments
    ADD CONSTRAINT ai_assessments_pkey PRIMARY KEY (assessment_id);


--
-- Name: answer_choices answer_choices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answer_choices
    ADD CONSTRAINT answer_choices_pkey PRIMARY KEY (choice_id);


--
-- Name: answer_choices answer_choices_question_id_choice_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answer_choices
    ADD CONSTRAINT answer_choices_question_id_choice_label_key UNIQUE (question_id, choice_label);


--
-- Name: assessment_attempts assessment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_attempts
    ADD CONSTRAINT assessment_attempts_pkey PRIMARY KEY (assessment_id, attempt_id);


--
-- Name: assessment_recommendations assessment_recommendations_assessment_id_skill_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_recommendations
    ADD CONSTRAINT assessment_recommendations_assessment_id_skill_id_key UNIQUE (assessment_id, skill_id);


--
-- Name: assessment_recommendations assessment_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_recommendations
    ADD CONSTRAINT assessment_recommendations_pkey PRIMARY KEY (recommendation_id);


--
-- Name: assessment_score_predictions assessment_score_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_score_predictions
    ADD CONSTRAINT assessment_score_predictions_pkey PRIMARY KEY (assessment_id);


--
-- Name: assessment_skill_results assessment_skill_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_skill_results
    ADD CONSTRAINT assessment_skill_results_pkey PRIMARY KEY (assessment_id, skill_id);


--
-- Name: attempt_questions attempt_questions_attempt_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_attempt_id_position_key UNIQUE (attempt_id, "position");


--
-- Name: attempt_questions attempt_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_pkey PRIMARY KEY (attempt_id, question_id);


--
-- Name: database_consolidation_rows database_consolidation_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_consolidation_rows
    ADD CONSTRAINT database_consolidation_rows_pkey PRIMARY KEY (migration_id, origin_database, table_name, source_key);


--
-- Name: database_consolidations database_consolidations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_consolidations
    ADD CONSTRAINT database_consolidations_pkey PRIMARY KEY (migration_id);


--
-- Name: import_batches import_batches_kind_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_kind_fingerprint_key UNIQUE (kind, fingerprint);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (batch_id);


--
-- Name: learning_answer_observations learning_answer_observations_attempt_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_observations
    ADD CONSTRAINT learning_answer_observations_attempt_id_question_id_key UNIQUE (attempt_id, question_id);


--
-- Name: learning_answer_observations learning_answer_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_observations
    ADD CONSTRAINT learning_answer_observations_pkey PRIMARY KEY (observation_id);


--
-- Name: learning_answer_revisions learning_answer_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_revisions
    ADD CONSTRAINT learning_answer_revisions_pkey PRIMARY KEY (revision_id);


--
-- Name: learning_attempt_sync learning_attempt_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_attempt_sync
    ADD CONSTRAINT learning_attempt_sync_pkey PRIMARY KEY (attempt_id);


--
-- Name: learning_events learning_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_pkey PRIMARY KEY (event_id);


--
-- Name: learning_events learning_events_user_id_client_session_id_client_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_user_id_client_session_id_client_sequence_key UNIQUE (user_id, client_session_id, client_sequence);


--
-- Name: learning_kc_mapping_versions learning_kc_mapping_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_kc_mapping_versions
    ADD CONSTRAINT learning_kc_mapping_versions_pkey PRIMARY KEY (mapping_version);


--
-- Name: listening_materials listening_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_materials
    ADD CONSTRAINT listening_materials_pkey PRIMARY KEY (material_id);


--
-- Name: question_group_passages question_group_passages_group_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_group_passages
    ADD CONSTRAINT question_group_passages_group_id_position_key UNIQUE (group_id, "position");


--
-- Name: question_group_passages question_group_passages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_group_passages
    ADD CONSTRAINT question_group_passages_pkey PRIMARY KEY (group_id, passage_id);


--
-- Name: question_groups question_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_groups
    ADD CONSTRAINT question_groups_pkey PRIMARY KEY (group_id);


--
-- Name: question_skills question_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_skills
    ADD CONSTRAINT question_skills_pkey PRIMARY KEY (question_id, skill_id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (question_id);


--
-- Name: reading_passages reading_passages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_passages
    ADD CONSTRAINT reading_passages_pkey PRIMARY KEY (passage_id);


--
-- Name: skills skills_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_code_key UNIQUE (code);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (skill_id);


--
-- Name: tests tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_pkey PRIMARY KEY (test_id);


--
-- Name: user_test_attempts uq_attempt_owner; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_test_attempts
    ADD CONSTRAINT uq_attempt_owner UNIQUE (attempt_id, user_id);


--
-- Name: user_answers uq_attempt_question; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_answers
    ADD CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id);


--
-- Name: questions uq_test_question_order; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT uq_test_question_order UNIQUE (test_id, order_in_test);


--
-- Name: user_stats uq_user_stats_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT uq_user_stats_user UNIQUE (user_id);


--
-- Name: user_answers user_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_answers
    ADD CONSTRAINT user_answers_pkey PRIMARY KEY (answer_id);


--
-- Name: user_stats user_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_pkey PRIMARY KEY (stat_id);


--
-- Name: user_test_attempts user_test_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_test_attempts
    ADD CONSTRAINT user_test_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: user_vocabulary_learning user_vocabulary_learning_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_vocabulary_learning
    ADD CONSTRAINT user_vocabulary_learning_pkey PRIMARY KEY (user_id, vocab_id);


--
-- Name: vocabulary vocabulary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary
    ADD CONSTRAINT vocabulary_pkey PRIMARY KEY (vocab_id);


--
-- Name: vocabulary_quiz_sessions vocabulary_quiz_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_quiz_sessions
    ADD CONSTRAINT vocabulary_quiz_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: vocabulary_study_sessions vocabulary_study_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_study_sessions
    ADD CONSTRAINT vocabulary_study_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: vocabulary_topics vocabulary_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_topics
    ADD CONSTRAINT vocabulary_topics_pkey PRIMARY KEY (topic_id);


--
-- Name: consolidation_attempt_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consolidation_attempt_origin ON public.database_consolidation_rows USING btree (table_name, origin_database);


--
-- Name: idx_assessment_attempts_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_attempts_attempt ON public.assessment_attempts USING btree (attempt_id);


--
-- Name: idx_assessment_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_queue ON public.ai_assessments USING btree (created_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_assessments_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessments_user_date ON public.ai_assessments USING btree (user_id, created_at DESC);


--
-- Name: idx_question_skills_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_skills_skill ON public.question_skills USING btree (skill_id, question_id);


--
-- Name: idx_questions_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_group ON public.questions USING btree (group_id);


--
-- Name: idx_questions_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_test ON public.questions USING btree (test_id);


--
-- Name: idx_questions_type_part; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_type_part ON public.questions USING btree (question_type, part_number);


--
-- Name: idx_recommendations_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendations_test ON public.assessment_recommendations USING btree (test_id);


--
-- Name: idx_user_answers_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_answers_question ON public.user_answers USING btree (question_id);


--
-- Name: idx_user_attempts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_attempts_user ON public.user_test_attempts USING btree (user_id, start_time DESC);


--
-- Name: idx_vocabulary_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vocabulary_topic ON public.vocabulary USING btree (topic_id);


--
-- Name: learning_answer_revisions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_answer_revisions_lookup ON public.learning_answer_revisions USING btree (attempt_id, question_id, revision_id);


--
-- Name: learning_events_owner_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_events_owner_attempt ON public.learning_events USING btree (user_id, attempt_id, received_at);


--
-- Name: learning_events_question_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_events_question_order ON public.learning_events USING btree (attempt_id, question_id, event_timestamp, client_sequence);


--
-- Name: learning_observations_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_observations_sequence ON public.learning_answer_observations USING btree (user_id, primary_kc, observed_at, attempt_id);


--
-- Name: learning_one_approved_mapping; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX learning_one_approved_mapping ON public.learning_kc_mapping_versions USING btree (question_id, question_version) WHERE (review_status = 'approved'::text);


--
-- Name: questions_source_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX questions_source_number_unique ON public.questions USING btree (lower(source_set), part_number, source_question_number) WHERE ((source_set IS NOT NULL) AND (source_question_number IS NOT NULL));


--
-- Name: vocabulary_personal_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vocabulary_personal_owner ON public.vocabulary USING btree (owner_user_id, topic_id);


--
-- Name: vocabulary_quiz_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vocabulary_quiz_owner ON public.vocabulary_quiz_sessions USING btree (user_id, created_at DESC);


--
-- Name: vocabulary_study_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vocabulary_study_active ON public.vocabulary_study_sessions USING btree (user_id, scope_key) WHERE (completed_at IS NULL);


--
-- Name: vocabulary_topics_legacy_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vocabulary_topics_legacy_name ON public.vocabulary_topics USING btree (name) WHERE (owner_user_id IS NULL);


--
-- Name: vocabulary_topics_personal_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vocabulary_topics_personal_name ON public.vocabulary_topics USING btree (owner_user_id, lower((name)::text)) WHERE (owner_user_id IS NOT NULL);


--
-- Name: user_answers learning_answer_revision_capture; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_answer_revision_capture AFTER INSERT OR UPDATE OF user_answer ON public.user_answers FOR EACH ROW EXECUTE FUNCTION public.learning_capture_answer_revision();


--
-- Name: learning_events learning_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_events_immutable BEFORE DELETE OR UPDATE ON public.learning_events FOR EACH ROW EXECUTE FUNCTION public.learning_append_only();


--
-- Name: learning_kc_mapping_versions learning_mapping_provenance_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_mapping_provenance_guard BEFORE DELETE OR UPDATE ON public.learning_kc_mapping_versions FOR EACH ROW EXECUTE FUNCTION public.learning_protect_mapping();


--
-- Name: learning_answer_observations learning_observations_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_observations_immutable BEFORE DELETE OR UPDATE ON public.learning_answer_observations FOR EACH ROW EXECUTE FUNCTION public.learning_append_only();


--
-- Name: learning_answer_revisions learning_revisions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_revisions_immutable BEFORE DELETE OR UPDATE ON public.learning_answer_revisions FOR EACH ROW EXECUTE FUNCTION public.learning_append_only();


--
-- Name: tests tests_publication_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tests_publication_sync BEFORE INSERT OR UPDATE ON public.tests FOR EACH ROW EXECUTE FUNCTION public.sync_test_publication();


--
-- Name: tests update_tests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tests_updated_at BEFORE UPDATE ON public.tests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_stats update_user_stats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_stats_updated_at BEFORE UPDATE ON public.user_stats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: User update_user_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON public."User" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: vocabulary update_vocabulary_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_vocabulary_updated_at BEFORE UPDATE ON public.vocabulary FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_assessments ai_assessments_trigger_attempt_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assessments
    ADD CONSTRAINT ai_assessments_trigger_attempt_id_user_id_fkey FOREIGN KEY (trigger_attempt_id, user_id) REFERENCES public.user_test_attempts(attempt_id, user_id);


--
-- Name: ai_assessments ai_assessments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assessments
    ADD CONSTRAINT ai_assessments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: answer_choices answer_choices_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answer_choices
    ADD CONSTRAINT answer_choices_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id) ON DELETE CASCADE;


--
-- Name: assessment_attempts assessment_attempts_assessment_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_attempts
    ADD CONSTRAINT assessment_attempts_assessment_id_user_id_fkey FOREIGN KEY (assessment_id, user_id) REFERENCES public.ai_assessments(assessment_id, user_id) ON DELETE CASCADE;


--
-- Name: assessment_attempts assessment_attempts_attempt_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_attempts
    ADD CONSTRAINT assessment_attempts_attempt_id_user_id_fkey FOREIGN KEY (attempt_id, user_id) REFERENCES public.user_test_attempts(attempt_id, user_id);


--
-- Name: assessment_recommendations assessment_recommendations_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_recommendations
    ADD CONSTRAINT assessment_recommendations_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.ai_assessments(assessment_id) ON DELETE CASCADE;


--
-- Name: assessment_recommendations assessment_recommendations_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_recommendations
    ADD CONSTRAINT assessment_recommendations_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(skill_id);


--
-- Name: assessment_recommendations assessment_recommendations_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_recommendations
    ADD CONSTRAINT assessment_recommendations_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(test_id) ON DELETE SET NULL;


--
-- Name: assessment_score_predictions assessment_score_predictions_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_score_predictions
    ADD CONSTRAINT assessment_score_predictions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.ai_assessments(assessment_id) ON DELETE CASCADE;


--
-- Name: assessment_skill_results assessment_skill_results_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_skill_results
    ADD CONSTRAINT assessment_skill_results_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.ai_assessments(assessment_id) ON DELETE CASCADE;


--
-- Name: assessment_skill_results assessment_skill_results_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_skill_results
    ADD CONSTRAINT assessment_skill_results_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(skill_id);


--
-- Name: attempt_questions attempt_questions_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.user_test_attempts(attempt_id) ON DELETE CASCADE;


--
-- Name: attempt_questions attempt_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id);


--
-- Name: database_consolidation_rows database_consolidation_rows_migration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_consolidation_rows
    ADD CONSTRAINT database_consolidation_rows_migration_id_fkey FOREIGN KEY (migration_id) REFERENCES public.database_consolidations(migration_id);


--
-- Name: user_answers fk_answer_presented_question; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_answers
    ADD CONSTRAINT fk_answer_presented_question FOREIGN KEY (attempt_id, question_id) REFERENCES public.attempt_questions(attempt_id, question_id) ON DELETE CASCADE;


--
-- Name: learning_answer_observations learning_answer_observations_attempt_id_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_observations
    ADD CONSTRAINT learning_answer_observations_attempt_id_question_id_fkey FOREIGN KEY (attempt_id, question_id) REFERENCES public.attempt_questions(attempt_id, question_id);


--
-- Name: learning_answer_observations learning_answer_observations_mapping_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_observations
    ADD CONSTRAINT learning_answer_observations_mapping_version_fkey FOREIGN KEY (mapping_version) REFERENCES public.learning_kc_mapping_versions(mapping_version);


--
-- Name: learning_answer_observations learning_answer_observations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_observations
    ADD CONSTRAINT learning_answer_observations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id);


--
-- Name: learning_answer_revisions learning_answer_revisions_attempt_id_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_revisions
    ADD CONSTRAINT learning_answer_revisions_attempt_id_question_id_fkey FOREIGN KEY (attempt_id, question_id) REFERENCES public.attempt_questions(attempt_id, question_id);


--
-- Name: learning_answer_revisions learning_answer_revisions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_answer_revisions
    ADD CONSTRAINT learning_answer_revisions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id);


--
-- Name: learning_attempt_sync learning_attempt_sync_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_attempt_sync
    ADD CONSTRAINT learning_attempt_sync_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.user_test_attempts(attempt_id);


--
-- Name: learning_events learning_events_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.user_test_attempts(attempt_id);


--
-- Name: learning_events learning_events_attempt_id_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_attempt_id_question_id_fkey FOREIGN KEY (attempt_id, question_id) REFERENCES public.attempt_questions(attempt_id, question_id);


--
-- Name: learning_events learning_events_mapping_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_mapping_fk FOREIGN KEY (mapping_version) REFERENCES public.learning_kc_mapping_versions(mapping_version);


--
-- Name: learning_events learning_events_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id);


--
-- Name: learning_events learning_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_events
    ADD CONSTRAINT learning_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id);


--
-- Name: learning_kc_mapping_versions learning_kc_mapping_versions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_kc_mapping_versions
    ADD CONSTRAINT learning_kc_mapping_versions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id);


--
-- Name: question_group_passages question_group_passages_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_group_passages
    ADD CONSTRAINT question_group_passages_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.question_groups(group_id) ON DELETE CASCADE;


--
-- Name: question_group_passages question_group_passages_passage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_group_passages
    ADD CONSTRAINT question_group_passages_passage_id_fkey FOREIGN KEY (passage_id) REFERENCES public.reading_passages(passage_id);


--
-- Name: question_groups question_groups_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_groups
    ADD CONSTRAINT question_groups_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.listening_materials(material_id);


--
-- Name: question_skills question_skills_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_skills
    ADD CONSTRAINT question_skills_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id) ON DELETE CASCADE;


--
-- Name: question_skills question_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_skills
    ADD CONSTRAINT question_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(skill_id);


--
-- Name: questions questions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.question_groups(group_id);


--
-- Name: questions questions_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.listening_materials(material_id);


--
-- Name: questions questions_passage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_passage_id_fkey FOREIGN KEY (passage_id) REFERENCES public.reading_passages(passage_id);


--
-- Name: questions questions_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(test_id) ON DELETE SET NULL;


--
-- Name: questions questions_vocab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_vocab_id_fkey FOREIGN KEY (vocab_id) REFERENCES public.vocabulary(vocab_id);


--
-- Name: tests tests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."User"(user_id);


--
-- Name: user_answers user_answers_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_answers
    ADD CONSTRAINT user_answers_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.user_test_attempts(attempt_id) ON DELETE CASCADE;


--
-- Name: user_answers user_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_answers
    ADD CONSTRAINT user_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id);


--
-- Name: user_stats user_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: user_test_attempts user_test_attempts_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_test_attempts
    ADD CONSTRAINT user_test_attempts_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(test_id);


--
-- Name: user_test_attempts user_test_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_test_attempts
    ADD CONSTRAINT user_test_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: user_vocabulary_learning user_vocabulary_learning_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_vocabulary_learning
    ADD CONSTRAINT user_vocabulary_learning_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: user_vocabulary_learning user_vocabulary_learning_vocab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_vocabulary_learning
    ADD CONSTRAINT user_vocabulary_learning_vocab_id_fkey FOREIGN KEY (vocab_id) REFERENCES public.vocabulary(vocab_id) ON DELETE CASCADE;


--
-- Name: vocabulary vocabulary_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary
    ADD CONSTRAINT vocabulary_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: vocabulary_quiz_sessions vocabulary_quiz_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_quiz_sessions
    ADD CONSTRAINT vocabulary_quiz_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: vocabulary_study_sessions vocabulary_study_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_study_sessions
    ADD CONSTRAINT vocabulary_study_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- Name: vocabulary vocabulary_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary
    ADD CONSTRAINT vocabulary_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.vocabulary_topics(topic_id);


--
-- Name: vocabulary_topics vocabulary_topics_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_topics
    ADD CONSTRAINT vocabulary_topics_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."User"(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 1JJbb0DLw5YT0FGc4Z7zlFYAKFLH7hCDm21aZafXPmOXkwjMycz8IXWUaXQRctB

