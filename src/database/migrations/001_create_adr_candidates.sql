CREATE TABLE IF NOT EXISTS adr_candidates (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    decision TEXT NOT NULL,
    context TEXT,
    job VARCHAR(50),

    status VARCHAR(30) NOT NULL DEFAULT 'Propuesto',
    review_status VARCHAR(30) NOT NULL DEFAULT 'Pendiente de revisión',

    decision_owner VARCHAR(255),

    source_file VARCHAR(500) NOT NULL,
    meeting_date DATE,
    source_hash VARCHAR(64) NOT NULL,

    evidence JSON,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);