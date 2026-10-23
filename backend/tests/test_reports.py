from regrow_api import reports

FACTS = {"recovery_by_summer_pct": {"2026": 75}, "milestones": [{"tranche_pct_of_funds": 30, "measured_recovery_pct": -38}]}


def test_numbers_must_come_from_the_facts():
    assert reports.unsupported_numbers("Recovery reached 75% in 2026; the 30% tranche was paid.", FACTS) == []
    assert reports.unsupported_numbers("Recovery reached 80% and 1,500 FLZ were paid.", FACTS) == ["1500", "80"]


def test_number_formats_are_normalised():
    # German and Turkish decimal commas, thousands separators and trailing zeros
    assert reports._numbers("75,0 % und 1.500 FLZ, 12.50 ha") == {"75", "1500", "12.5"}


def test_turkish_percent_sign_comes_first():
    assert reports.turkish_percent("hedefi 30% ve -38%, zaten %75") == "hedefi %30 ve -%38, zaten %75"
