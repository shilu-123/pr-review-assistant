from sqlalchemy import Column, DateTime, Integer, JSON, String, Text, func

from database import Base


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)

    pr_url = Column(String, nullable=False)
    pr_title = Column(String, nullable=False)
    pr_author = Column(String, nullable=False)
    base_branch = Column(String, nullable=False)
    head_branch = Column(String, nullable=False)

    additions = Column(Integer, nullable=False)
    deletions = Column(Integer, nullable=False)
    changed_files_count = Column(Integer, nullable=False)

    summary = Column(Text, nullable=False)
    file_reviews = Column(JSON, nullable=False)  # list[{"filename": str, "review": str}]
    files = Column(JSON, nullable=False)  # the diff files, so history detail can re-render them

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
