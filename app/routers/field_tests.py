from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from ..database import get_session
from ..models import FieldTest
from ..schemas import FieldTestInput, FieldTestRead


router = APIRouter(prefix="/api/field-tests", tags=["field-tests"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[FieldTestRead])
def list_field_tests(
    session: SessionDep,
    athlete_name: str | None = None,
    protocol: str | None = None,
):
    query = select(FieldTest).order_by(FieldTest.test_date.desc(), FieldTest.created_at.desc())
    if athlete_name:
        query = query.where(FieldTest.athlete_name == athlete_name.upper())
    if protocol:
        query = query.where(FieldTest.protocol == protocol)
    return session.exec(query).all()


@router.post("", response_model=FieldTestRead, status_code=status.HTTP_201_CREATED)
def create_field_test(payload: FieldTestInput, session: SessionDep):
    test = FieldTest(**payload.model_dump())
    session.add(test)
    session.commit()
    session.refresh(test)
    return test


@router.delete("/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field_test(test_id: str, session: SessionDep):
    test = session.get(FieldTest, test_id)
    if not test:
        raise HTTPException(status_code=404, detail="Test no encontrado")
    session.delete(test)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
