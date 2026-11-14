from decimal import Decimal

from app.services.finance import Balance, Flow, net_income, net_worth, summarize


def test_financial_math_rounds_to_currency_precision():
    assert net_income(Decimal("100.00"), Decimal("33.335")) == Decimal("66.67")
    assert net_worth(Decimal("1200.00"), Decimal("450.25")) == Decimal("749.75")


def test_finance_summary_excludes_other_currencies_and_estimates_from_actuals():
    result = summarize(
        income=[
            Flow(Decimal("1000.00"), "USD", "actual", source="salary"),
            Flow(Decimal("500.00"), "LKR", "actual", source="salary"),
            Flow(Decimal("200.00"), "USD", "projected", source="freelance"),
        ],
        expenses=[Flow(Decimal("250.00"), "USD", "actual", category="food")],
        assets=[Balance(Decimal("1200.00"), "USD", "actual")],
        liabilities=[Balance(Decimal("300.00"), "USD", "actual")],
        currency="USD",
    )

    assert result["total_income"] == Decimal("1000.00")
    assert result["total_expenses"] == Decimal("250.00")
    assert result["net_worth"] == Decimal("900.00")
    assert result["excluded_currencies"] == ["LKR"]
