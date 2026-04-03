"""People CRUD endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Person
from schemas import PersonCreate, PersonOut

router = APIRouter(prefix="/people", tags=["people"])


@router.get("", response_model=list[PersonOut])
def list_people(db: Session = Depends(get_db)):
    return db.query(Person).order_by(Person.name).all()


@router.get("/{person_id}", response_model=PersonOut)
def get_person(person_id: int, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    return person


@router.post("", response_model=PersonOut, status_code=201)
def create_person(data: PersonCreate, db: Session = Depends(get_db)):
    person = Person(**data.model_dump())
    db.add(person)
    db.commit()
    db.refresh(person)
    return person
